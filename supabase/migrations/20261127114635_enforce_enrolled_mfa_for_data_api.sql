create or replace function loox_private.enrolled_mfa_satisfied()
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select auth.jwt()->>'aal')='aal2',false)
 or not exists(select 1 from auth.mfa_factors f where f.user_id=(select auth.uid()) and f.status='verified');
$$;
revoke all on function loox_private.enrolled_mfa_satisfied() from public,anon;
grant execute on function loox_private.enrolled_mfa_satisfied() to authenticated,service_role;
do $$
declare t record;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where (n.nspname='public' or (n.nspname='storage' and c.relname='objects')) and c.relkind in ('r','p') and c.relrowsecurity
 and (has_table_privilege('authenticated',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'INSERT') or has_table_privilege('authenticated',c.oid,'UPDATE') or has_table_privilege('authenticated',c.oid,'DELETE'))
 loop
 execute format('create policy loox_enrolled_mfa_gate on %I.%I as restrictive for all to authenticated using ((select loox_private.enrolled_mfa_satisfied())) with check ((select loox_private.enrolled_mfa_satisfied()))',t.nspname,t.relname);
 end loop;
end $$;
