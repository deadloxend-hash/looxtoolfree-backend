-- Apply once in the dedicated LOOX Tools project, as the database owner.
begin;
create table public.loox_plans (
 id text primary key, price_cents integer not null check(price_cents>=0),
 credits integer not null check(credits>=0), cadence text not null
);
insert into public.loox_plans values ('free',0,10,'signup'),('pro',999,100,'month'),('lifetime',4900,50,'once');
create table public.loox_operations (
 id text primary key, cost integer not null check(cost>0), max_millicents integer not null check(max_millicents>0)
);
-- Conservative spending estimates in thousandths of one US cent. Count every submission attempt.
insert into public.loox_operations values ('background',1,3000),('upscale2',2,4000),('upscale4',4,4000),('erase',2,6000),('generate',3,1000);
create table public.loox_profiles (user_id uuid primary key references auth.users on delete cascade, name text not null, terms_version text not null, created_at timestamptz default now(), deleting boolean not null default false);
create table public.loox_wallets (user_id uuid primary key references public.loox_profiles on delete cascade, balance integer not null default 0 check(balance>=0), debt integer not null default 0 check(debt>=0));
-- A keyed email fingerprint survives deletion to prevent bonus farming. No raw email here.
create table public.loox_bonus_claims (fingerprint text primary key);
create table public.loox_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.loox_profiles on delete cascade,
 request_id uuid not null, digest text not null, operation text not null references public.loox_operations,
 cost integer not null, state text not null default 'reserved' check(state in ('reserved','processing','succeeded','failed')),
 prediction text unique, result_path text, inputs_clean boolean not null default false, created_at timestamptz not null default now(), unique(user_id,request_id)
);
create index on public.loox_jobs(user_id,created_at desc);
create index on public.loox_jobs(created_at) where state in ('reserved','processing');
create table public.loox_credits (id bigint generated always as identity primary key, user_id uuid not null references public.loox_profiles on delete cascade,
 reason text not null, amount integer not null, reference text not null, created_at timestamptz not null default now(), unique(user_id,reason,reference));
create index on public.loox_credits(user_id,created_at desc);
create table public.loox_subscriptions (provider_id text primary key, user_id uuid not null references public.loox_profiles on delete cascade, plan text not null references public.loox_plans,
 status text not null, ends_at timestamptz, updated_at timestamptz not null);
create index on public.loox_subscriptions(user_id);
create table public.loox_payments (reference text primary key, user_id uuid not null references public.loox_profiles on delete cascade, plan text not null references public.loox_plans,
 amount_cents integer not null, currency text not null, status text not null, credits integer not null default 0, created_at timestamptz not null default now());
create index on public.loox_payments(user_id,created_at desc);
create table public.loox_spend (day date primary key, millicents bigint not null default 0);
create table public.loox_limits (key text primary key, used integer not null, expires_at timestamptz not null);
create index on public.loox_limits(expires_at);

create function public.loox_account(p_user uuid,p_name text,p_fingerprint text,p_terms text) returns void language plpgsql set search_path='' as $$
declare claimed integer;
begin
 insert into public.loox_profiles(user_id,name,terms_version) values(p_user,left(p_name,80),p_terms) on conflict do nothing;
 if not found then return; end if;
 insert into public.loox_wallets(user_id) values(p_user);
 insert into public.loox_bonus_claims values(p_fingerprint) on conflict do nothing;
 if found then
  select credits into claimed from public.loox_plans where id='free';
  update public.loox_wallets set balance=claimed where user_id=p_user;
  insert into public.loox_credits(user_id,reason,amount,reference) values(p_user,'Signup bonus',claimed,'signup');
 end if;
end $$;

create function public.loox_rate(p_key text,p_limit integer,p_seconds integer) returns void language plpgsql set search_path='' as $$
declare n integer;
begin
 insert into public.loox_limits as r values(p_key,1,now()+make_interval(secs=>p_seconds))
 on conflict(key) do update set used=case when r.expires_at<=now() then 1 else r.used+1 end,
 expires_at=case when r.expires_at<=now() then excluded.expires_at else r.expires_at end returning used into n;
 if n>p_limit then raise exception 'rate_limited'; end if;
end $$;

create function public.loox_reserve(p_user uuid,p_request uuid,p_digest text,p_operation text,p_daily integer,p_budget bigint)
returns jsonb language plpgsql set search_path='' as $$
declare w public.loox_wallets; j public.loox_jobs; op public.loox_operations; total bigint;
begin
 perform 1 from public.loox_profiles where user_id=p_user and not deleting for share;
 if not found then raise exception 'account_unavailable'; end if;
 select * into strict w from public.loox_wallets where user_id=p_user for update;
 select * into j from public.loox_jobs where user_id=p_user and request_id=p_request;
 if found then
  if j.digest<>p_digest then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('id',j.id,'fresh',false);
 end if;
 select * into strict op from public.loox_operations where id=p_operation;
 if w.balance<op.cost or w.debt>0 then raise exception 'insufficient_credits'; end if;
 if (select count(*) from public.loox_jobs where user_id=p_user and created_at>now()-interval '24 hours')>=p_daily
 or (select count(*) from public.loox_jobs where user_id=p_user and state in ('reserved','processing'))>=2 then raise exception 'rate_limited'; end if;
 insert into public.loox_spend as s values((now() at time zone 'UTC')::date,op.max_millicents)
 on conflict(day) do update set millicents=s.millicents+excluded.millicents returning millicents into total;
 if total>p_budget then raise exception 'budget_limit'; end if;
 insert into public.loox_jobs(user_id,request_id,digest,operation,cost) values(p_user,p_request,p_digest,p_operation,op.cost) returning * into j;
 update public.loox_wallets set balance=balance-op.cost where user_id=p_user;
 insert into public.loox_credits(user_id,reason,amount,reference) values(p_user,'Reserved',-op.cost,j.id::text);
 return jsonb_build_object('id',j.id,'fresh',true);
end $$;

create function public.loox_finish(p_id uuid,p_path text) returns void language plpgsql set search_path='' as $$
declare j public.loox_jobs;
begin
 select * into strict j from public.loox_jobs where id=p_id for update;
 if j.state in ('succeeded','failed') then return; end if;
 update public.loox_jobs set state=case when p_path is null then 'failed' else 'succeeded' end,result_path=p_path where id=j.id;
 if p_path is null then
  update public.loox_wallets set balance=balance+greatest(0,j.cost-debt),debt=greatest(0,debt-j.cost) where user_id=j.user_id;
 end if;
 insert into public.loox_credits(user_id,reason,amount,reference) values(j.user_id,case when p_path is null then 'Released' else 'Completed' end,case when p_path is null then j.cost else 0 end,j.id::text);
end $$;

-- Lifecycle messages use provider timestamps. An invoice/order can grant its allowance only once.
create function public.loox_billing(p_user uuid,p_plan text,p_ref text,p_status text,p_amount integer,p_currency text,p_subscription text,p_updated timestamptz,p_ends timestamptz)
returns void language plpgsql set search_path='' as $$
declare w public.loox_wallets; pay public.loox_payments; allowance integer;
begin
 perform 1 from public.loox_profiles where user_id=p_user and not deleting for share;
 if not found then raise exception 'account_unavailable'; end if;
 select * into strict w from public.loox_wallets where user_id=p_user for update;
 if p_subscription is not null then
  insert into public.loox_subscriptions values(p_subscription,p_user,p_plan,p_status,p_ends,p_updated)
  on conflict(provider_id) do update set status=excluded.status, ends_at=excluded.ends_at, updated_at=excluded.updated_at
   where loox_subscriptions.user_id=excluded.user_id and loox_subscriptions.updated_at<excluded.updated_at;
  return;
 end if;
 if p_status not in ('paid','refunded','failed') then raise exception 'invalid_payment'; end if;
 select * into pay from public.loox_payments where reference=p_ref;
 if found and (pay.user_id<>p_user or pay.plan<>p_plan) then raise exception 'invalid_payment'; end if;
 if pay.status=p_status or pay.status='refunded' or (pay.status='paid' and p_status='failed') then return; end if;
 select credits into strict allowance from public.loox_plans where id=p_plan;
 if p_status='paid' then
  update public.loox_wallets set balance=balance+greatest(allowance-debt,0),debt=greatest(0,debt-allowance) where user_id=p_user;
  insert into public.loox_credits(user_id,reason,amount,reference) values(p_user,'Purchase',allowance,p_ref);
 elsif p_status='refunded' and pay.status='paid' then
  allowance:=pay.credits;
  update public.loox_wallets set debt=debt+greatest(allowance-balance,0),balance=greatest(0,balance-allowance) where user_id=p_user;
  insert into public.loox_credits(user_id,reason,amount,reference) values(p_user,'Refund',-allowance,p_ref);
 end if;
 insert into public.loox_payments values(p_ref,p_user,p_plan,p_amount,p_currency,p_status,case when p_status='paid' then allowance else 0 end,now())
 on conflict(reference) do update set status=excluded.status,credits=excluded.credits;
end $$;

create function public.loox_begin_delete(p_user uuid) returns void language plpgsql set search_path='' as $$
begin
 perform 1 from public.loox_profiles where user_id=p_user for update;
 if exists(select from public.loox_subscriptions where user_id=p_user and status not in ('expired','cancelled')) then raise exception 'cancel_first'; end if;
 if exists(select from public.loox_jobs where user_id=p_user and state in ('reserved','processing')) then raise exception 'jobs_pending'; end if;
 update public.loox_profiles set deleting=true where user_id=p_user;
end $$;

do $$
declare tbl text; fn regprocedure;
begin
 for tbl in select tablename from pg_tables where schemaname='public' and left(tablename,5)='loox_' loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on table public.%I from public,anon,authenticated',tbl);
  execute format('grant all on table public.%I to service_role',tbl);
  if tbl in ('loox_profiles','loox_wallets','loox_credits','loox_jobs','loox_payments','loox_subscriptions') then
   execute format('create policy own_rows on public.%I for select to authenticated using ((select auth.uid())=user_id)',tbl);
   execute format('grant select on public.%I to authenticated',tbl);
  end if;
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,5)='loox_' loop
  execute format('revoke all on function %s from public,anon,authenticated',fn);
  execute format('grant execute on function %s to service_role',fn);
 end loop;
end $$;
grant usage,select on sequence public.loox_credits_id_seq to service_role;
-- Account bootstrapping checks the Supabase-confirmed identity through the backend first.
-- Keep auth.users private; the verified auth user lookup is outside the invoker RPC.
insert into storage.buckets(id,name,public) values('loox-results','loox-results',false);
commit;
