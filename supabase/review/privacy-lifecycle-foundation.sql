-- Additive privacy foundation: no existing users, content or credits are deleted.
create table public.loox_privacy_proofs(
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null,
 expires_at timestamptz not null default(now()+interval '2 minutes'),
 used_at timestamptz
);
alter table public.loox_privacy_proofs enable row level security;
revoke all on public.loox_privacy_proofs from public,anon,authenticated;
grant all on public.loox_privacy_proofs to service_role;

create function loox_private.loox_issue_privacy_proof(p_user uuid,p_session uuid,p_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_hash !~ '^[a-f0-9]{64}$' or not exists(select 1 from auth.sessions where id=p_session and user_id=p_user and (not_after is null or not_after>now())) then raise exception 'Invalid privacy proof'; end if;
 -- Expired operational proof records only, never account/content/credit data.
 delete from public.loox_privacy_proofs where user_id=p_user and expires_at<now();
 insert into public.loox_privacy_proofs(token_hash,user_id,session_id) values(p_hash,p_user,p_session);
end $$;
create function public.loox_issue_privacy_proof(p_user uuid,p_session uuid,p_hash text)
returns void language sql set search_path='' as $$select loox_private.loox_issue_privacy_proof(p_user,p_session,p_hash)$$;
revoke all on function public.loox_issue_privacy_proof(uuid,uuid,text),loox_private.loox_issue_privacy_proof(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.loox_issue_privacy_proof(uuid,uuid,text),loox_private.loox_issue_privacy_proof(uuid,uuid,text) to service_role;

create function loox_private.loox_consume_privacy_proof(p_token text)
returns boolean language plpgsql security definer set search_path='' as $$
declare matched text;
begin
 if auth.uid() is null or length(p_token)<>43 then return false; end if;
 update public.loox_privacy_proofs set used_at=now()
 where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
 and user_id=auth.uid() and session_id=nullif(auth.jwt()->>'session_id','')::uuid
 and exists(select 1 from auth.sessions s where s.id=session_id and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
 and used_at is null and expires_at>now()
 returning token_hash into matched;
 return matched is not null;
end $$;
create function public.loox_consume_privacy_proof(p_token text)
returns boolean language sql set search_path='' as $$select loox_private.loox_consume_privacy_proof(p_token)$$;
revoke all on function public.loox_consume_privacy_proof(text),loox_private.loox_consume_privacy_proof(text) from public,anon;
grant execute on function public.loox_consume_privacy_proof(text),loox_private.loox_consume_privacy_proof(text) to authenticated,service_role;

create function loox_private.loox_account_deletion_constraints(p_user uuid)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('requires_support',
 exists(select 1 from public.loox_payments where user_id=p_user)
 or exists(select 1 from public.loox_recharge_payments where user_id=p_user)
 or exists(select 1 from public.loox_subscriptions where user_id=p_user)
 or exists(select 1 from public.loox_invoice_refunds where user_id=p_user)
 or exists(select 1 from public.loox_wallets where user_id=p_user and debt>0)
 or exists(select 1 from public.loox_admin_roles where user_id=p_user)
 or exists(select 1 from public.loox_admin_reads where user_id=p_user)
 or exists(select 1 from public.loox_moderation_log where admin_id=p_user)
 or exists(select 1 from public.loox_template_catalog where media_key like 'users/'||p_user::text||'/%' or thumbnail_key like 'users/'||p_user::text||'/%' or media_key like 'public/templates/'||p_user::text||'/%' or media_path like p_user::text||'/%')
 or exists(select 1 from storage.objects where (owner=p_user or owner_id=p_user::text or name like p_user::text||'/%') and not(bucket_id in ('loox-results','loox-avatars') and name like p_user::text||'/%'))
 )
$$;
revoke all on function loox_private.loox_account_deletion_constraints(uuid) from public,anon,authenticated;
grant execute on function loox_private.loox_account_deletion_constraints(uuid) to service_role;

create function loox_private.loox_security_summary(p_user uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.sessions where id=p_session and user_id=p_user and (not_after is null or not_after>now())) then raise exception 'privacy_session_missing'; end if;
 return jsonb_build_object(
 'deletion',loox_private.loox_account_deletion_constraints(p_user),
 'sessions',coalesce((select jsonb_agg(jsonb_build_object('current',s.id=p_session,'created_at',s.created_at,'refreshed_at',s.refreshed_at at time zone 'UTC','expires_at',s.not_after,'user_agent',left(s.user_agent,180),'mfa',s.aal::text='aal2') order by s.created_at desc) from (select id,created_at,refreshed_at,not_after,user_agent,aal from auth.sessions where user_id=p_user and (not_after is null or not_after>now()) order by created_at desc limit 50)s),'[]'::jsonb),
 'activity',coalesce((select jsonb_agg(jsonb_build_object('action',left(e.payload->>'action',80),'created_at',e.created_at) order by e.created_at desc) from (select payload,created_at from auth.audit_log_entries where payload->>'actor_id'=p_user::text order by created_at desc limit 30)e),'[]'::jsonb)
 );
end $$;
create function public.loox_security_summary(p_user uuid,p_session uuid)
returns jsonb language sql set search_path='' as $$select loox_private.loox_security_summary(p_user,p_session)$$;
revoke all on function public.loox_security_summary(uuid,uuid),loox_private.loox_security_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function public.loox_security_summary(uuid,uuid),loox_private.loox_security_summary(uuid,uuid) to service_role;

create function loox_private.loox_account_storage_inventory(p_user uuid,p_after text default '',p_limit integer default 100)
returns table(bucket_id text,name text,bytes bigint,content_type text)
language sql security definer set search_path='' as $$
 select o.bucket_id,o.name,
 case when o.metadata->>'size' ~ '^[0-9]{1,18}$' then (o.metadata->>'size')::bigint else 0 end,
 left(o.metadata->>'mimetype',160)
 from storage.objects o
 where o.bucket_id in ('loox-results','loox-avatars')
 and o.name like p_user::text||'/%'
 and o.bucket_id||'/'||o.name>coalesce(p_after,'')
 order by o.bucket_id,o.name limit greatest(1,least(coalesce(p_limit,100),500))
$$;
create function public.loox_account_storage_inventory(p_user uuid,p_after text default '',p_limit integer default 100)
returns table(bucket_id text,name text,bytes bigint,content_type text)
language sql set search_path='' as $$select * from loox_private.loox_account_storage_inventory(p_user,p_after,p_limit)$$;
revoke all on function public.loox_account_storage_inventory(uuid,text,integer),loox_private.loox_account_storage_inventory(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.loox_account_storage_inventory(uuid,text,integer),loox_private.loox_account_storage_inventory(uuid,text,integer) to service_role;
