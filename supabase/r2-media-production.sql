begin;

alter table public.loox_jobs
 add column if not exists storage_provider text not null default 'supabase',
 add column if not exists object_key text,
 add column if not exists thumbnail_key text,
 add column if not exists media_type text,
 add column if not exists media_bytes bigint,
 add column if not exists media_sha256 text;
alter table public.loox_jobs drop constraint if exists loox_jobs_storage_provider_check;
alter table public.loox_jobs add constraint loox_jobs_storage_provider_check check(storage_provider in ('supabase','r2'));
alter table public.loox_jobs drop constraint if exists loox_jobs_media_sha256_check;
alter table public.loox_jobs add constraint loox_jobs_media_sha256_check check(media_sha256 is null or media_sha256 ~ '^[a-f0-9]{64}$');
create index if not exists loox_jobs_owner_request on public.loox_jobs(user_id,request_id);
create index if not exists loox_jobs_owner_created on public.loox_jobs(user_id,created_at desc,id);

alter table public.loox_community_posts
 add column if not exists media_provider text not null default 'supabase',
 add column if not exists media_key text,
 add column if not exists thumbnail_key text;
alter table public.loox_template_catalog
 add column if not exists media_provider text not null default 'supabase',
 add column if not exists media_key text,
 add column if not exists thumbnail_key text;
alter table public.loox_creator_profiles
 add column if not exists avatar_provider text not null default 'supabase',
 add column if not exists avatar_key text,
 add column if not exists avatar_thumbnail_key text;

create table if not exists public.loox_media_migrations(
 id bigint generated always as identity primary key,
 source_bucket text not null,
 source_path text not null,
 target_key text not null,
 owner_id uuid,
 category text not null,
 status text not null default 'pending' check(status in ('pending','copying','verified','failed')),
 source_bytes bigint,
 target_bytes bigint,
 sha256 text,
 attempts integer not null default 0,
 error_code text,
 updated_at timestamptz not null default now(),
 unique(source_bucket,source_path),
 unique(target_key)
);
alter table public.loox_media_migrations enable row level security;
revoke all on public.loox_media_migrations from anon,authenticated;

create table if not exists public.loox_chat_attachments(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 thread_id uuid not null references public.loox_chat_threads(id) on delete cascade,
 message_id bigint references public.loox_chat_messages(id) on delete cascade,
 object_key text not null,
 thumbnail_key text,
 media_type text not null check(media_type in ('image/png','image/jpeg','image/webp')),
 media_bytes bigint not null check(media_bytes between 1 and 8000000),
 created_at timestamptz not null default now(),
 unique(user_id,object_key)
);
alter table public.loox_chat_attachments enable row level security;
create policy loox_chat_attachments_owner_read on public.loox_chat_attachments for select to authenticated using((select auth.uid())=user_id);
create policy loox_chat_attachments_owner_delete on public.loox_chat_attachments for delete to authenticated using((select auth.uid())=user_id);
revoke insert,update on public.loox_chat_attachments from anon,authenticated;
create index if not exists loox_chat_attachments_thread on public.loox_chat_attachments(user_id,thread_id,created_at);

create or replace function public.loox_finish_media(p_id uuid,p_provider text,p_key text,p_thumbnail text,p_type text,p_bytes bigint,p_sha256 text)
returns boolean language plpgsql set search_path='' as $$
declare j public.loox_jobs; legacy text;
begin
 select * into j from public.loox_jobs where id=p_id for update;
 if not found then return false; end if;
 if j.state='succeeded' then return j.object_key=p_key; end if;
 if j.state='failed' or p_provider<>'r2' or p_key is null or p_bytes not between 1 and 40000000
   or p_sha256 !~ '^[a-f0-9]{64}$' or p_type not in ('image/png','image/jpeg','image/webp','video/mp4')
   or p_key not like 'users/'||j.user_id::text||'/generations/'||j.id::text||'.%' then return false; end if;
 legacy=j.user_id::text||'/'||j.id::text||case p_type when 'video/mp4' then '.mp4' when 'image/jpeg' then '.jpg' when 'image/webp' then '.webp' else '.png' end;
 update public.loox_jobs set state='succeeded',result_path=legacy,storage_provider='r2',object_key=p_key,
  thumbnail_key=p_thumbnail,media_type=p_type,media_bytes=p_bytes,media_sha256=p_sha256 where id=j.id;
 insert into public.loox_credits(user_id,reason,amount,reference) values(j.user_id,'Completed',0,j.id::text);
 return true;
end $$;

create or replace function public.loox_local_complete_media(p_id uuid,p_lease uuid,p_provider text,p_key text,p_thumbnail text,p_type text,p_bytes bigint,p_sha256 text)
returns boolean language plpgsql set search_path='' as $$
declare q public.loox_local_queue; ok boolean;
begin
 select * into q from public.loox_local_queue where job_id=p_id for update;
 if not found or q.lease is distinct from p_lease then return false; end if;
 if (select state from public.loox_jobs where id=p_id) not in ('processing','reserved') then return false; end if;
 if p_key is distinct from ('users/'||q.user_id::text||'/generations/'||q.job_id::text||case when q.operation='generate_video' then '.mp4' else '.png' end) then return false; end if;
 ok=public.loox_finish_media(p_id,p_provider,p_key,p_thumbnail,p_type,p_bytes,p_sha256);
 if not ok then return false; end if;
 delete from public.loox_local_queue where job_id=p_id;
 return true;
end $$;

create or replace function public.loox_session_thumbnails(p_sessions uuid[])
returns table(session_id uuid,job_id uuid,media_type text) language sql stable set search_path='' as $$
 select distinct on(e.session_id) e.session_id,j.id,e.media_type
 from public.loox_media_entries e join public.loox_jobs j on j.request_id=e.request_id and j.user_id=e.user_id
 where e.session_id=any(p_sessions) and e.user_id=(select auth.uid()) and j.state='succeeded'
   and (j.result_path is not null or j.object_key is not null)
 order by e.session_id,e.created_at desc,e.id;
$$;

create or replace function public.loox_sync_community_post()
returns trigger language plpgsql security definer set search_path='' as $$
declare j public.loox_jobs;
begin
 select * into j from public.loox_jobs where id=new.job_id and user_id=new.user_id and state='succeeded';
 if (j.result_path is null and j.object_key is null) then return new;end if;
 insert into public.loox_creator_profiles(user_id,username) values(new.user_id,'creator_'||left(replace(new.user_id::text,'-',''),20)) on conflict(user_id) do nothing;
 insert into public.loox_community_posts(id,creator_id,job_id,media_path,media_type,caption,shared_prompt,status,visible,created_at,model_id,media_provider,media_key,thumbnail_key)
 values(new.id,new.user_id,new.job_id,coalesce(j.result_path,j.object_key),case when j.media_type='video/mp4' or j.operation='generate_video' or j.operation like 'video_%' then 'video' else 'image' end,coalesce(nullif(new.caption,''),case when new.share_prompt then left(new.prompt,120) else 'Untitled creation' end),case when new.share_prompt then new.prompt end,new.status,new.visible,new.submitted_at,j.operation,j.storage_provider,j.object_key,j.thumbnail_key)
 on conflict(id) do update set caption=excluded.caption,shared_prompt=excluded.shared_prompt,status=excluded.status,visible=excluded.visible,media_path=excluded.media_path,media_type=excluded.media_type,model_id=excluded.model_id,media_provider=excluded.media_provider,media_key=excluded.media_key,thumbnail_key=excluded.thumbnail_key;
 if tg_op='UPDATE' and old.status is distinct from new.status and new.status in ('approved','rejected') then
  insert into public.loox_notifications(user_id,kind,post_id) select new.user_id,new.status,new.id where exists(select 1 from public.loox_creator_profiles where user_id=new.user_id and notifications_enabled);
 end if;
 return new;
end $$;

create index if not exists loox_media_entries_session_order on public.loox_media_entries(user_id,session_id,created_at,id);
create index if not exists loox_media_sessions_owner_updated on public.loox_media_sessions(user_id,updated_at desc,id);
create index if not exists loox_chat_attachments_thread_fk on public.loox_chat_attachments(thread_id);
create index if not exists loox_chat_attachments_message_fk on public.loox_chat_attachments(message_id);

insert into public.loox_media_migrations(source_bucket,source_path,target_key,owner_id,category,source_bytes)
select o.bucket_id,o.name,
 case
  when o.bucket_id='loox-results' then 'users/'||split_part(o.name,'/',1)||'/'||case when o.name like '%-reference_image.%' or o.name like '%-target_image.%' or o.name like '%-swap_image.%' or o.name like '%-video-source.%' then 'inputs' else 'generations' end||'/'||split_part(o.name,'/',2)
  when o.bucket_id='loox-avatars' then 'public/avatars/'||o.name
  else 'public/templates/'||o.name end,
 case when o.name ~ '^[a-f0-9-]{36}/' then split_part(o.name,'/',1)::uuid else null end,
 case when o.bucket_id='loox-avatars' then 'avatars' when o.bucket_id='loox-templates' then 'templates' when o.name like '%-reference_image.%' or o.name like '%-target_image.%' or o.name like '%-swap_image.%' or o.name like '%-video-source.%' then 'inputs' else 'generations' end,
 coalesce((o.metadata->>'size')::bigint,0)
from storage.objects o where o.bucket_id in ('loox-results','loox-avatars','loox-templates')
on conflict(source_bucket,source_path) do nothing;

update public.loox_community_posts p
set media_provider=j.storage_provider,media_key=j.object_key,thumbnail_key=j.thumbnail_key
from public.loox_jobs j
where p.job_id=j.id and j.storage_provider='r2' and j.object_key is not null
 and (p.media_provider is distinct from 'r2' or p.media_key is distinct from j.object_key);

create or replace function loox_private.loox_save_creator(p_username text,p_name text,p_bio text,p_avatar text default null)
returns void language plpgsql security definer set search_path='' as $$
declare avatar_key text;
begin
 if auth.uid() is null then raise exception 'Sign in to edit your profile'; end if;
 if p_avatar is not null and p_avatar not like auth.uid()::text||'/%' then raise exception 'Invalid avatar path'; end if;
 if p_avatar is not null then avatar_key='public/avatars/'||auth.uid()::text||'/'||split_part(p_avatar,'/',2); end if;
 insert into public.loox_creator_profiles(user_id,username,display_name,bio,avatar_path,avatar_provider,avatar_key,avatar_thumbnail_key)
 values(auth.uid(),lower(trim(p_username)),trim(p_name),trim(p_bio),p_avatar,case when p_avatar is null then 'supabase' else 'r2' end,avatar_key,avatar_key)
 on conflict(user_id) do update set username=excluded.username,display_name=excluded.display_name,bio=excluded.bio,avatar_path=excluded.avatar_path,
  avatar_provider=case when excluded.avatar_path is distinct from public.loox_creator_profiles.avatar_path then excluded.avatar_provider else public.loox_creator_profiles.avatar_provider end,
  avatar_key=case when excluded.avatar_path is distinct from public.loox_creator_profiles.avatar_path then excluded.avatar_key else public.loox_creator_profiles.avatar_key end,
  avatar_thumbnail_key=case when excluded.avatar_path is distinct from public.loox_creator_profiles.avatar_path then excluded.avatar_thumbnail_key else public.loox_creator_profiles.avatar_thumbnail_key end;
end $$;

commit;
