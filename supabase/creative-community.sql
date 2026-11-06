-- Social metadata extends the existing explicit submission + admin approval flow.
-- Existing private jobs, prompts, wallets and result objects are not republished.
alter table public.loox_template_submissions add column caption text not null default '' check(length(caption)<=300);
alter table public.loox_template_submissions add column share_prompt boolean not null default true;
alter table public.loox_template_submissions add column visible boolean not null default true;
create table public.loox_creator_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check(username ~ '^[a-z0-9_]{3,30}$'),
 display_name text not null default 'LOOX creator' check(length(display_name) between 1 and 60),
 bio text not null default '' check(length(bio)<=500),
 avatar_path text,
 created_at timestamptz not null default now()
);
create table public.loox_community_posts(
 id uuid primary key references public.loox_template_submissions(id) on delete cascade,
 creator_id uuid not null references public.loox_creator_profiles(user_id) on delete cascade,
 job_id uuid not null unique references public.loox_jobs(id) on delete cascade,
 media_path text not null,
 media_type text not null check(media_type in ('image','video')),
 caption text not null check(length(caption)<=300),
 shared_prompt text,
 status text not null check(status in ('pending','approved','rejected')),
 visible boolean not null,
 created_at timestamptz not null
);
create table public.loox_post_likes(
 post_id uuid not null references public.loox_community_posts(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(post_id,user_id)
);
create table public.loox_creator_follows(
 follower_id uuid not null references auth.users(id) on delete cascade,
 creator_id uuid not null references public.loox_creator_profiles(user_id) on delete cascade,
 created_at timestamptz not null default now(),primary key(follower_id,creator_id),check(follower_id<>creator_id)
);
create index loox_public_feed on public.loox_community_posts(status,visible,created_at desc);
create index loox_creator_posts on public.loox_community_posts(creator_id,created_at desc);
create index loox_followers on public.loox_creator_follows(creator_id);
create index loox_my_likes on public.loox_post_likes(user_id);
alter table public.loox_creator_profiles enable row level security;
alter table public.loox_community_posts enable row level security;
alter table public.loox_post_likes enable row level security;
alter table public.loox_creator_follows enable row level security;
revoke all on public.loox_creator_profiles,public.loox_community_posts,public.loox_post_likes,public.loox_creator_follows from anon,authenticated;
grant select on public.loox_creator_profiles,public.loox_community_posts to anon,authenticated;
grant select,insert,delete on public.loox_post_likes,public.loox_creator_follows to authenticated;
create policy public_profiles on public.loox_creator_profiles for select to anon,authenticated using(true);
create policy visible_posts on public.loox_community_posts for select to anon,authenticated using(
 (status='approved' and visible) or creator_id=(select auth.uid()) or coalesce((select auth.jwt())->'app_metadata'->>'loox_template_admin','false')='true');
create policy my_likes on public.loox_post_likes for select to authenticated using(user_id=(select auth.uid()));
create policy like_public_post on public.loox_post_likes for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.loox_community_posts where id=post_id and status='approved' and visible));
create policy unlike on public.loox_post_likes for delete to authenticated using(user_id=(select auth.uid()));
create policy my_follows on public.loox_creator_follows for select to authenticated using(follower_id=(select auth.uid()));
create policy follow_creator on public.loox_creator_follows for insert to authenticated with check(follower_id=(select auth.uid()) and follower_id<>creator_id);
create policy unfollow_creator on public.loox_creator_follows for delete to authenticated using(follower_id=(select auth.uid()));
-- Only consented submissions are mirrored. The original private prompt stays private
-- when share_prompt is false, even if queried directly through the Data API.
create function public.loox_sync_community_post() returns trigger language plpgsql security definer set search_path='' as $$
declare j public.loox_jobs;
begin
 select * into j from public.loox_jobs where id=new.job_id and user_id=new.user_id and state='succeeded';
 if j.result_path is null or j.result_path not like new.user_id::text||'/%' then return new; end if;
 insert into public.loox_creator_profiles(user_id,username) values(new.user_id,'creator_'||left(replace(new.user_id::text,'-',''),20)) on conflict(user_id) do nothing;
 insert into public.loox_community_posts(id,creator_id,job_id,media_path,media_type,caption,shared_prompt,status,visible,created_at)
 values(new.id,new.user_id,new.job_id,j.result_path,case when j.operation='generate_video' then 'video' else 'image' end,
 coalesce(nullif(new.caption,''),left(new.prompt,120)),case when new.share_prompt then new.prompt end,new.status,new.visible,new.submitted_at)
 on conflict(id) do update set caption=excluded.caption,shared_prompt=excluded.shared_prompt,status=excluded.status,visible=excluded.visible,media_path=excluded.media_path;
 return new;
end $$;
revoke all on function public.loox_sync_community_post() from public,anon,authenticated;
create trigger loox_sync_public_submission after insert or update on public.loox_template_submissions for each row execute function public.loox_sync_community_post();
-- Backfill only previously consented submissions, preserving their moderation state.
update public.loox_template_submissions set caption=caption;

create function public.loox_save_creator(p_username text,p_name text,p_bio text,p_avatar text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to edit your profile'; end if;
 if p_avatar is not null and p_avatar not like auth.uid()::text||'/%' then raise exception 'Invalid avatar path'; end if;
 insert into public.loox_creator_profiles(user_id,username,display_name,bio,avatar_path) values(auth.uid(),lower(trim(p_username)),trim(p_name),trim(p_bio),p_avatar)
 on conflict(user_id) do update set username=excluded.username,display_name=excluded.display_name,bio=excluded.bio,avatar_path=excluded.avatar_path;
end $$;
create function public.loox_publish_creation(p_job uuid,p_caption text,p_share_prompt boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.loox_jobs; s uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to publish'; end if;
 select * into j from public.loox_jobs where id=p_job and user_id=auth.uid() and state='succeeded' and (operation='generate' or operation like 'generate_%');
 if j.id is null or j.prompt is null or j.result_path is null or j.result_path not like auth.uid()::text||'/%' then raise exception 'Completed creation not found'; end if;
 insert into public.loox_template_submissions(user_id,job_id,prompt,caption,share_prompt,status) values(auth.uid(),j.id,j.prompt,trim(p_caption),p_share_prompt,'pending') returning id into s;
 return s;
exception when unique_violation then raise exception 'This creation has already been submitted. Manage it from your profile.';
end $$;
create function public.loox_manage_post(p_id uuid,p_action text,p_caption text default null,p_share_prompt boolean default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.loox_template_submissions where id=p_id and user_id=auth.uid()) then raise exception 'Post not found'; end if;
 if p_action='delete' then delete from public.loox_template_submissions where id=p_id and user_id=auth.uid();
 elsif p_action in ('hide','show') then update public.loox_template_submissions set visible=(p_action='show') where id=p_id and user_id=auth.uid();
 elsif p_action='edit' then update public.loox_template_submissions set caption=coalesce(p_caption,caption),share_prompt=coalesce(p_share_prompt,share_prompt),status='pending',reviewed_at=null,reviewed_by=null where id=p_id and user_id=auth.uid();
 else raise exception 'Unknown post action'; end if;
end $$;
create function public.loox_review_creation(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'loox_template_admin'='true') then raise exception 'Administrator access required'; end if;
 if p_status not in ('approved','rejected') then raise exception 'Invalid review'; end if;
 update public.loox_template_submissions set status=p_status,reviewed_at=now(),reviewed_by=auth.uid() where id=p_id and status='pending';
 if not found then raise exception 'Submission no longer pending'; end if;
end $$;
create function public.loox_community_feed(p_kind text default 'all',p_sort text default 'latest',p_offset integer default 0,p_creator uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 with ranked as (
 select p.*,c.username,c.display_name,c.avatar_path,
 (select count(*) from public.loox_post_likes l where l.post_id=p.id) as likes,
 exists(select 1 from public.loox_post_likes l where l.post_id=p.id and l.user_id=auth.uid()) as liked
 from public.loox_community_posts p join public.loox_creator_profiles c on c.user_id=p.creator_id
 where p.status='approved' and p.visible and (p_kind='all' or p.media_type=p_kind) and (p_creator is null or p.creator_id=p_creator)
 ), page as(select * from ranked order by case when p_sort='popular' then likes else 0 end desc,created_at desc,id limit 25 offset greatest(0,least(p_offset,10000)))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(t)) from(select * from page limit 24)t),'[]'::jsonb),'has_more',(select count(*)>24 from page));
$$;
create function public.loox_creator_summary(p_creator uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object('posts',(select count(*) from public.loox_community_posts p where p.creator_id=c.user_id and p.status='approved' and p.visible),
 'followers',(select count(*) from public.loox_creator_follows f where f.creator_id=c.user_id),'following',(select count(*) from public.loox_creator_follows f where f.follower_id=c.user_id),
 'followed',exists(select 1 from public.loox_creator_follows f where f.creator_id=c.user_id and f.follower_id=auth.uid())) from public.loox_creator_profiles c where c.user_id=p_creator;
$$;
revoke all on function public.loox_save_creator(text,text,text,text),public.loox_publish_creation(uuid,text,boolean),public.loox_manage_post(uuid,text,text,boolean),public.loox_review_creation(uuid,text) from public,anon;
grant execute on function public.loox_save_creator(text,text,text,text),public.loox_publish_creation(uuid,text,boolean),public.loox_manage_post(uuid,text,text,boolean),public.loox_review_creation(uuid,text) to authenticated;
revoke all on function public.loox_community_feed(text,text,integer,uuid),public.loox_creator_summary(uuid) from public;
grant execute on function public.loox_community_feed(text,text,integer,uuid),public.loox_creator_summary(uuid) to anon,authenticated;
-- Select permission is granted only to explicitly approved public result paths,
-- plus the owner/admin preview of consented submissions. No private-job read grant.
create policy consented_community_media on storage.objects for select to anon,authenticated using(bucket_id='loox-results' and exists(select 1 from public.loox_community_posts p where p.media_path=name));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('loox-avatars','loox-avatars',false,2097152,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create policy public_creator_avatars on storage.objects for select to anon,authenticated using(bucket_id='loox-avatars');
create policy upload_own_avatar on storage.objects for insert to authenticated with check(bucket_id='loox-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- Read-only lookup runs as the caller: existing jobs/session RLS applies.
create function public.loox_session_thumbnails(p_sessions uuid[]) returns table(session_id uuid,job_id uuid,media_type text) language sql stable security invoker set search_path='' as $$
 select distinct on(e.session_id) e.session_id,j.id,e.media_type from public.loox_media_entries e join public.loox_jobs j on j.request_id=e.request_id and j.user_id=e.user_id
 where e.session_id=any(p_sessions) and e.user_id=auth.uid() and j.state='succeeded' and j.result_path is not null
 order by e.session_id,e.created_at desc,e.id;
$$;
revoke all on function public.loox_session_thumbnails(uuid[]) from public,anon;
grant execute on function public.loox_session_thumbnails(uuid[]) to authenticated;
