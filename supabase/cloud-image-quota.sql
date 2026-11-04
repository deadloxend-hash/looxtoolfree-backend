-- Count every local or cloud image against the same UTC daily image allowance.
create or replace function public.loox_reserve(p_user uuid,p_request uuid,p_digest text,p_operation text,p_daily integer,p_budget bigint)
returns jsonb language plpgsql set search_path='' as $$
declare w public.loox_wallets; j public.loox_jobs; op public.loox_operations; total bigint; start_utc timestamptz;
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
 start_utc := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if (select count(*) from public.loox_jobs
     where user_id=p_user and state<>'failed' and created_at>=start_utc
       and (case
         when p_operation='generate_video' then operation='generate_video'
         when p_operation='generate' or p_operation like 'generate_%' then operation='generate' or (operation like 'generate_%' and operation<>'generate_video')
         else operation=p_operation
       end))>=p_daily
 then raise exception 'daily_generation_limit'; end if;
 if (select count(*) from public.loox_jobs where user_id=p_user and state in ('reserved','processing'))>=2
 then raise exception 'jobs_in_progress'; end if;
 insert into public.loox_spend as s values((now() at time zone 'UTC')::date,op.max_millicents)
 on conflict(day) do update set millicents=s.millicents+excluded.millicents returning millicents into total;
 if total>p_budget then raise exception 'budget_limit'; end if;
 insert into public.loox_jobs(user_id,request_id,digest,operation,cost) values(p_user,p_request,p_digest,p_operation,op.cost) returning * into j;
 update public.loox_wallets set balance=balance-op.cost where user_id=p_user;
 insert into public.loox_credits(user_id,reason,amount,reference) values(p_user,'Reserved',-op.cost,j.id::text);
 return jsonb_build_object('id',j.id,'fresh',true);
end $$;
