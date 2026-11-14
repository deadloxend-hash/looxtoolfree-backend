-- Additive foundation. No balance reset, deletion, cancellation or annual record change.
begin;
create table public.loox_recharge_packages (
 id text primary key, name text not null, credits integer not null check(credits>0),
 price_cents integer not null check(price_cents>0), approved boolean not null default false,
 variant_id text unique, updated_at timestamptz not null default now()
);
insert into public.loox_recharge_packages(id,name,credits,price_cents) values
 ('mini','Mini Recharge',100,500),('creator_boost','Creator Boost',300,1000),
 ('power','Power Pack',750,2500),('pro_recharge','Pro Recharge',1500,4500);
create table public.loox_recharge_payments (
 reference text primary key, user_id uuid not null, package_id text not null,
 amount_cents integer not null check(amount_cents>0), currency text not null check(currency='USD'),
 credits integer not null check(credits>0), status text not null check(status in ('paid','refunded','chargeback')),
 reversed_credits integer not null default 0, refunded_cents integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(reversed_credits between 0 and credits), check(refunded_cents between 0 and amount_cents)
);
create index on public.loox_recharge_payments(user_id,created_at desc);
create table public.loox_balance_changes (
 id bigint generated always as identity primary key,user_id uuid not null,transaction_id bigint not null default txid_current(),
 balance_before integer not null,balance_after integer not null,debt_before integer not null,debt_after integer not null,
 created_at timestamptz not null default now()
);
create index on public.loox_balance_changes(user_id,created_at desc);
create function public.loox_capture_balance() returns trigger language plpgsql set search_path='' as $$
begin
 if new.balance is distinct from old.balance or new.debt is distinct from old.debt then
 insert into public.loox_balance_changes(user_id,balance_before,balance_after,debt_before,debt_after)
 values(new.user_id,old.balance,new.balance,old.debt,new.debt);end if;return new;
end $$;
create trigger loox_wallet_audit after update on public.loox_wallets for each row execute function public.loox_capture_balance();
-- Wallet lock + reference lock serialize payment replay, including cross-account attempts.
create function public.loox_recharge_settle(p_user uuid,p_reference text,p_package text,p_credits integer,p_amount integer,p_refunded integer,p_chargeback boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare w public.loox_wallets; pay public.loox_recharge_payments; target integer; delta integer;
begin
 if p_reference !~ '^orders/[0-9]+$' or p_amount<=0 or p_credits<=0 or p_refunded<0 or p_refunded>p_amount then raise exception 'invalid_payment';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_reference,0));
 select * into strict w from public.loox_wallets where user_id=p_user for update;
 select * into pay from public.loox_recharge_payments where reference=p_reference for update;
 if found and (pay.user_id<>p_user or pay.package_id<>p_package or pay.amount_cents<>p_amount or pay.credits<>p_credits) then raise exception 'invalid_payment';end if;
 if not found then
 insert into public.loox_recharge_payments(reference,user_id,package_id,amount_cents,currency,credits,status)
 values(p_reference,p_user,p_package,p_amount,'USD',p_credits,'paid') returning * into pay;
 update public.loox_wallets set balance=balance+greatest(p_credits-debt,0),debt=greatest(debt-p_credits,0) where user_id=p_user;
 insert into public.loox_credits(user_id,reason,amount,reference) values(p_user,'Recharge',p_credits,p_reference);
 end if;
 -- Refunds are cumulative. A stale paid event never restores a reversed grant.
 target:=case when p_chargeback then pay.credits else ceil(pay.credits::numeric*p_refunded/pay.amount_cents)::integer end;
 delta:=greatest(target-pay.reversed_credits,0);
 if delta>0 then
 update public.loox_wallets set balance=greatest(balance-delta,0),debt=debt+greatest(delta-balance,0) where user_id=p_user;
 insert into public.loox_credits(user_id,reason,amount,reference) values(p_user,case when p_chargeback then 'Chargeback' else 'Recharge refund' end,-delta,p_reference||'/'||target);
 update public.loox_recharge_payments set reversed_credits=target,refunded_cents=greatest(refunded_cents,p_refunded),status=case when p_chargeback then 'chargeback' else 'refunded' end,updated_at=now() where reference=p_reference;
 end if;
 return jsonb_build_object('settled',true,'reversed',delta);
end $$;
create table public.loox_payment_events (
 digest text primary key, event_name text not null,resource_reference text not null,
 status text not null default 'pending' check(status in ('pending','processed','failed')),
 attempts integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create function public.loox_claim_payment_event(p_digest text,p_event text,p_reference text) returns boolean language plpgsql set search_path='' as $$
begin
 insert into public.loox_payment_events as e(digest,event_name,resource_reference) values(p_digest,p_event,p_reference)
 on conflict(digest) do update set status='pending',attempts=e.attempts+1,updated_at=now()
 where e.status='failed' or (e.status='pending' and e.updated_at<now()-interval '5 minutes');
 return found;
end $$;
create table public.loox_security_alerts (
 id uuid primary key default gen_random_uuid(),dedupe_key text not null,category text not null,severity text not null,service text not null,
 occurrences integer not null default 1,created_at timestamptz not null default now(),last_seen timestamptz not null default now(),
 claimed_at timestamptz,sent_at timestamptz
);
create index on public.loox_security_alerts(dedupe_key,last_seen desc);
create function public.loox_security_incident(p_key text,p_category text,p_severity text,p_service text) returns void language plpgsql set search_path='' as $$
declare existing uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_key,0));
 select id into existing from public.loox_security_alerts where dedupe_key=p_key and created_at>now()-interval '1 hour' order by created_at desc limit 1;
 if found then update public.loox_security_alerts set occurrences=occurrences+1,last_seen=now() where id=existing;
 else insert into public.loox_security_alerts(dedupe_key,category,severity,service) values(p_key,p_category,p_severity,p_service);end if;
end $$;
create function public.loox_claim_alerts() returns setof public.loox_security_alerts language sql set search_path='' as $$
 update public.loox_security_alerts set claimed_at=now() where id in
 (select id from public.loox_security_alerts where sent_at is null and (claimed_at is null or claimed_at<now()-interval '15 minutes') order by created_at limit 10 for update skip locked) returning *;
$$;
create table public.loox_financial_audit (
 id bigint generated always as identity primary key,admin_id uuid not null,action text not null,created_at timestamptz not null default now()
);
create table public.loox_cost_controls (
 id boolean primary key default true check(id),user_daily_millicents bigint not null check(user_daily_millicents>0),
 operation_max_millicents bigint not null check(operation_max_millicents>0),disabled_operations text[] not null default '{}'
);
insert into public.loox_cost_controls values(true,500000,1000000,'{}');
create index if not exists loox_jobs_user_day on public.loox_jobs(user_id,created_at);
create function public.loox_generation_cost_guard() returns trigger language plpgsql set search_path='' as $$
declare c public.loox_cost_controls; estimate bigint; spent bigint;
begin
 select * into strict c from public.loox_cost_controls where id;
 select max_millicents into strict estimate from public.loox_operations where id=new.operation;
 if new.operation=any(c.disabled_operations) or estimate>c.operation_max_millicents then raise exception 'budget_limit';end if;
 -- loox_reserve already holds the user's wallet lock. Failed attempts still count.
 select coalesce(sum(o.max_millicents),0) into spent from public.loox_jobs j join public.loox_operations o on o.id=j.operation
 where j.user_id=new.user_id and j.created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if spent+estimate>c.user_daily_millicents then raise exception 'budget_limit';end if;return new;
end $$;
create trigger loox_job_cost_guard before insert on public.loox_jobs for each row execute function public.loox_generation_cost_guard();
-- New tables and functions are backend-only, with no direct browser write path.
do $$declare t text;f regprocedure;begin
 foreach t in array array['recharge_packages','recharge_payments','balance_changes','payment_events','security_alerts','financial_audit','cost_controls'] loop
 execute format('alter table public.loox_%I enable row level security',t);
 execute format('revoke all on public.loox_%I from public,anon,authenticated',t);
 execute format('grant select,insert,update on public.loox_%I to service_role',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in ('loox_capture_balance','loox_recharge_settle','loox_claim_payment_event','loox_security_incident','loox_claim_alerts','loox_generation_cost_guard') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);end loop;
end $$;
grant usage,select on sequence public.loox_balance_changes_id_seq,public.loox_financial_audit_id_seq to service_role;
revoke update on public.loox_balance_changes,public.loox_financial_audit from service_role;
create function public.loox_worker_nonce(p_nonce text) returns void language plpgsql set search_path='' as $$
begin
 if p_nonce !~ '^[a-f0-9]{32}$' then raise exception 'invalid_nonce';end if;
 insert into public.loox_limits(key,used,expires_at) values('worker-nonce:'||p_nonce,1,now()+interval '5 minutes') on conflict do nothing;
 if not found then raise exception 'worker_replay';end if;
end $$;
revoke all on function public.loox_worker_nonce(text) from public,anon,authenticated;
grant execute on function public.loox_worker_nonce(text) to service_role;
commit;
