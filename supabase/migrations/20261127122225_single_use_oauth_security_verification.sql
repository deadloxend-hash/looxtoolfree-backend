create table public.loox_oauth_reauth_receipts(
 session_id uuid not null references auth.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 purpose text not null check(purpose in ('account','export','delete','sessions','mfa')),
 created_at timestamptz not null default now(),
 primary key(session_id,purpose)
);
alter table public.loox_oauth_reauth_receipts enable row level security;
revoke all on public.loox_oauth_reauth_receipts from public,anon,authenticated;
grant all on public.loox_oauth_reauth_receipts to service_role;
create function loox_private.loox_consume_recent_oauth(p_user uuid,p_session uuid,p_purpose text)
returns boolean language plpgsql security definer set search_path='' as $$
declare consumed uuid;
begin
 if p_purpose not in ('account','export','delete','sessions','mfa') or not exists(
  select 1 from auth.sessions s where s.id=p_session and s.user_id=p_user
  and s.created_at>=now()-interval '5 minutes' and s.created_at<=now()+interval '30 seconds'
  and (s.not_after is null or s.not_after>now())
  and (s.aal::text='aal2' or not exists(select 1 from auth.mfa_factors f where f.user_id=p_user and f.status='verified'))
 ) then return false; end if;
 insert into public.loox_oauth_reauth_receipts(session_id,user_id,purpose)
 values(p_session,p_user,p_purpose) on conflict do nothing returning session_id into consumed;
 return consumed is not null;
end $$;
create function public.loox_consume_recent_oauth(p_user uuid,p_session uuid,p_purpose text)
returns boolean language sql set search_path='' as $$ select loox_private.loox_consume_recent_oauth(p_user,p_session,p_purpose) $$;
revoke all on function public.loox_consume_recent_oauth(uuid,uuid,text),loox_private.loox_consume_recent_oauth(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.loox_consume_recent_oauth(uuid,uuid,text),loox_private.loox_consume_recent_oauth(uuid,uuid,text) to service_role;

