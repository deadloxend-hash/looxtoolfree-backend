begin;
-- Enforce MFA on existing direct browser admin policies without changing public reads.
do $$declare p record;begin
 for p in select * from pg_policies where schemaname='public' and tablename in ('loox_template_catalog','loox_template_categories','loox_template_styles') and policyname not in ('browse_original_templates','public_categories','public_styles') loop
  if p.qual is not null then execute format('alter policy %I on public.%I using ((%s) and (select auth.jwt()->>''aal'')=''aal2'')',p.policyname,p.tablename,p.qual);end if;
  if p.with_check is not null then execute format('alter policy %I on public.%I with check ((%s) and (select auth.jwt()->>''aal'')=''aal2'')',p.policyname,p.tablename,p.with_check);end if;
 end loop;
end $$;
alter policy visible_posts on public.loox_community_posts using
 (loox_private.public_post(id) or creator_id=(select auth.uid()) or
 ((coalesce((select auth.jwt())->'app_metadata'->>'loox_template_admin','false')='true') and (select auth.jwt()->>'aal')='aal2'));
alter table public.loox_jobs add column budget_estimate_millicents bigint check(budget_estimate_millicents>0);
alter table public.loox_cost_controls add column circuit_min_jobs integer not null default 8 check(circuit_min_jobs between 6 and 100);
alter table public.loox_cost_controls add column circuit_min_users integer not null default 3 check(circuit_min_users between 3 and 100);
alter table public.loox_cost_controls add column circuit_failure_percent integer not null default 80 check(circuit_failure_percent between 70 and 100);
alter table public.loox_cost_controls add column circuit_pause_minutes integer not null default 15 check(circuit_pause_minutes between 5 and 120);
create table public.loox_model_circuits(
 operation text primary key references public.loox_operations(id),paused_until timestamptz not null,
 reason text not null check(reason in ('failure_rate','manual')),sample_jobs integer not null,failed_jobs integer not null,
 distinct_users integer not null,updated_at timestamptz not null default now()
);
alter table public.loox_model_circuits enable row level security;
revoke all on public.loox_model_circuits from public,anon,authenticated;
grant select,insert,update on public.loox_model_circuits to service_role;
create or replace function public.loox_generation_cost_guard() returns trigger language plpgsql set search_path='' as $$
declare c public.loox_cost_controls;estimate bigint;spent bigint;
begin
 select * into strict c from public.loox_cost_controls where id;
 select max_millicents into strict estimate from public.loox_operations where id=new.operation;
 if new.operation=any(c.disabled_operations) or estimate>c.operation_max_millicents then raise exception 'budget_limit';end if;
 if exists(select 1 from public.loox_model_circuits where operation=new.operation and paused_until>now()) then raise exception 'model_circuit_open';end if;
 select coalesce(sum(coalesce(j.budget_estimate_millicents,o.max_millicents)),0) into spent
 from public.loox_jobs j join public.loox_operations o on o.id=j.operation
 where j.user_id=new.user_id and j.created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if spent+estimate>c.user_daily_millicents then raise exception 'budget_limit';end if;
 new.budget_estimate_millicents:=estimate;return new;
end $$;
create function public.loox_generation_circuit_monitor() returns trigger language plpgsql set search_path='' as $$
declare c public.loox_cost_controls;n integer;bad integer;users integer;prior public.loox_model_circuits;
begin
 if new.state not in ('failed','succeeded') or old.state=new.state then return new;end if;
 select * into strict c from public.loox_cost_controls where id;
 -- Multiple independent users are required: one abusive client cannot pause a model.
 select count(*),count(*) filter(where state='failed'),count(distinct user_id) into n,bad,users
 from (select state,user_id from public.loox_jobs where operation=new.operation and state in ('failed','succeeded') and created_at>now()-interval '30 minutes' order by created_at desc limit 100) samples;
 if n<c.circuit_min_jobs or users<c.circuit_min_users or bad*100<n*c.circuit_failure_percent then return new;end if;
 select * into prior from public.loox_model_circuits where operation=new.operation;
 if prior.paused_until>now() then return new;end if;
 insert into public.loox_model_circuits as existing(operation,paused_until,reason,sample_jobs,failed_jobs,distinct_users)
 values(new.operation,now()+make_interval(mins=>c.circuit_pause_minutes),'failure_rate',n,bad,users)
 on conflict(operation) do update set paused_until=excluded.paused_until,reason=excluded.reason,sample_jobs=n,failed_jobs=bad,distinct_users=users,updated_at=now();
 perform public.loox_security_incident(encode(sha256(('generation-circuit:'||new.operation)::bytea),'hex'),'generation_failure','high','generation');
 return new;
end $$;
create trigger loox_job_circuit_monitor after update of state on public.loox_jobs for each row execute function public.loox_generation_circuit_monitor();
revoke all on function public.loox_generation_circuit_monitor() from public,anon,authenticated;
grant execute on function public.loox_generation_circuit_monitor() to service_role;
-- Direct authenticated template writes get an audit row without granting clients log-write access.
create function loox_private.audit_template_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then return new;end if;
 if coalesce((select auth.jwt())->'app_metadata'->>'loox_template_admin','false')<>'true' or (select auth.jwt()->>'aal')<>'aal2' then raise exception 'Administrator MFA required';end if;
 insert into public.loox_moderation_log(admin_id,action,reason) values((select auth.uid()),'template_admin_write',tg_table_name||' / '||tg_op);
 return new;
end $$;
revoke all on function loox_private.audit_template_write() from public,anon,authenticated;
grant execute on function loox_private.audit_template_write() to service_role;
create trigger loox_template_catalog_audit after insert or update or delete on public.loox_template_catalog for each row execute function loox_private.audit_template_write();
create trigger loox_template_categories_audit after insert or update or delete on public.loox_template_categories for each row execute function loox_private.audit_template_write();
create trigger loox_template_styles_audit after insert or update or delete on public.loox_template_styles for each row execute function loox_private.audit_template_write();
commit;
