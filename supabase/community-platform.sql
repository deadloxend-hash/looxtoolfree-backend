-- Additive community upgrade. No account, credit, generation or file deletion.
create schema if not exists loox_private;
revoke all on schema loox_private from public;
grant usage on schema loox_private to anon,authenticated;

alter table public.loox_creator_profiles add column is_private boolean not null default false;
alter table public.loox_creator_profiles add column hide_connections boolean not null default false;
alter table public.loox_creator_profiles add column notifications_enabled boolean not null default true;
alter table public.loox_community_posts add column comments_enabled boolean not null default true;
alter table public.loox_community_posts add column allow_remix boolean not null default true;
alter table public.loox_community_posts add column allow_download boolean not null default true;
alter table public.loox_community_posts add column model_id text;
-- Derive media type from the trusted backend operation, never file extensions.
update public.loox_community_posts p set media_type=case when j.operation='generate_video' or j.operation like 'video_%' then 'video' else 'image' end,model_id=j.operation
from public.loox_jobs j where j.id=p.job_id;

create function loox_private.public_creator(p_creator uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.loox_creator_profiles where user_id=p_creator and not is_private);
$$;
create function loox_private.public_post(p_post uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.loox_community_posts p join public.loox_creator_profiles c on c.user_id=p.creator_id join public.loox_jobs j on j.id=p.job_id
 where p.id=p_post and p.status='approved' and p.visible and not c.is_private and j.state='succeeded' and j.result_path=p.media_path);
$$;
revoke all on function loox_private.public_creator(uuid),loox_private.public_post(uuid) from public;
grant execute on function loox_private.public_creator(uuid),loox_private.public_post(uuid) to anon,authenticated;
alter policy public_profiles on public.loox_creator_profiles using(not is_private or user_id=(select auth.uid()));
alter policy visible_posts on public.loox_community_posts using(loox_private.public_post(id) or creator_id=(select auth.uid()) or coalesce((select auth.jwt())->'app_metadata'->>'loox_template_admin','false')='true');
alter policy like_public_post on public.loox_post_likes with check(user_id=(select auth.uid()) and loox_private.public_post(post_id) and not exists(select 1 from public.loox_community_posts p where p.id=post_id and p.creator_id=(select auth.uid())));
alter policy follow_creator on public.loox_creator_follows with check(follower_id=(select auth.uid()) and follower_id<>creator_id and loox_private.public_creator(creator_id));
alter policy consented_community_media on storage.objects using(bucket_id='loox-results' and exists(select 1 from public.loox_community_posts p where p.media_path=name and (loox_private.public_post(p.id) or p.creator_id=(select auth.uid()) or coalesce((select auth.jwt())->'app_metadata'->>'loox_template_admin','false')='true')));
alter policy public_creator_avatars on storage.objects using(bucket_id='loox-avatars' and exists(select 1 from public.loox_creator_profiles c where c.avatar_path=name and (not c.is_private or c.user_id=(select auth.uid()))));
create policy remove_own_avatar on storage.objects for delete to authenticated using(bucket_id='loox-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
grant delete on storage.objects to authenticated;

create table public.loox_saved_posts(user_id uuid not null references auth.users(id) on delete cascade,post_id uuid not null references public.loox_community_posts(id) on delete cascade,created_at timestamptz not null default now(),primary key(user_id,post_id));
create table public.loox_collections(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,name text not null check(length(trim(name)) between 1 and 80),is_public boolean not null default false,created_at timestamptz not null default now());
create table public.loox_collection_items(collection_id uuid not null references public.loox_collections(id) on delete cascade,post_id uuid not null references public.loox_community_posts(id) on delete cascade,position integer not null default 0,created_at timestamptz not null default now(),primary key(collection_id,post_id));
create table public.loox_post_comments(id uuid primary key default gen_random_uuid(),post_id uuid not null references public.loox_community_posts(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,body text not null check(length(trim(body)) between 1 and 1200),created_at timestamptz not null default now());
create table public.loox_content_reports(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,post_id uuid not null references public.loox_community_posts(id) on delete cascade,comment_id uuid references public.loox_post_comments(id) on delete cascade,reason text not null check(length(trim(reason)) between 5 and 1000),status text not null default 'open' check(status in ('open','resolved','dismissed')),created_at timestamptz not null default now());
create table public.loox_notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,actor_id uuid references auth.users(id) on delete cascade,kind text not null check(kind in ('like','follow','comment','approved','rejected')),post_id uuid references public.loox_community_posts(id) on delete cascade,is_read boolean not null default false,created_at timestamptz not null default now());
create table public.loox_moderation_log(id uuid primary key default gen_random_uuid(),admin_id uuid not null references auth.users(id),post_id uuid,action text not null,reason text not null default '',created_at timestamptz not null default now());
create index loox_saves_post on public.loox_saved_posts(post_id);
create index loox_collections_owner on public.loox_collections(user_id,created_at desc);
create index loox_items_post on public.loox_collection_items(post_id);
create index loox_comments_page on public.loox_post_comments(post_id,created_at,id);
create index loox_comments_user on public.loox_post_comments(user_id,created_at desc);
create index loox_reports_queue on public.loox_content_reports(status,created_at desc);
create index loox_reports_owner on public.loox_content_reports(user_id,created_at desc);
create index loox_notifications_owner on public.loox_notifications(user_id,created_at desc);
create index loox_notifications_actor on public.loox_notifications(actor_id);
create index loox_notifications_post on public.loox_notifications(post_id);

alter table public.loox_saved_posts enable row level security;
alter table public.loox_collections enable row level security;
alter table public.loox_collection_items enable row level security;
alter table public.loox_post_comments enable row level security;
alter table public.loox_content_reports enable row level security;
alter table public.loox_notifications enable row level security;
alter table public.loox_moderation_log enable row level security;
revoke all on public.loox_saved_posts,public.loox_collections,public.loox_collection_items,public.loox_post_comments,public.loox_content_reports,public.loox_notifications,public.loox_moderation_log from anon,authenticated;
grant select,insert,delete on public.loox_saved_posts,public.loox_collection_items,public.loox_post_comments to authenticated;
grant select,insert,update,delete on public.loox_collections to authenticated;
grant select on public.loox_collections,public.loox_collection_items,public.loox_post_comments to anon;
grant select,insert on public.loox_content_reports to authenticated;
grant select on public.loox_notifications to authenticated;
grant update(is_read) on public.loox_notifications to authenticated;
-- Moderation log is backend-only; no client grants or client policies.
create policy own_saves on public.loox_saved_posts for select to authenticated using(user_id=(select auth.uid()) and loox_private.public_post(post_id));
create policy save_public on public.loox_saved_posts for insert to authenticated with check(user_id=(select auth.uid()) and loox_private.public_post(post_id));
create policy unsave on public.loox_saved_posts for delete to authenticated using(user_id=(select auth.uid()));
create policy read_collections on public.loox_collections for select to anon,authenticated using(user_id=(select auth.uid()) or (is_public and loox_private.public_creator(user_id)));
create policy create_collection on public.loox_collections for insert to authenticated with check(user_id=(select auth.uid()));
create policy edit_collection on public.loox_collections for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy delete_collection on public.loox_collections for delete to authenticated using(user_id=(select auth.uid()));
create policy read_collection_items on public.loox_collection_items for select to anon,authenticated using(loox_private.public_post(post_id) and exists(select 1 from public.loox_collections c where c.id=collection_id));
create policy add_collection_item on public.loox_collection_items for insert to authenticated with check(loox_private.public_post(post_id) and exists(select 1 from public.loox_collections c where c.id=collection_id and c.user_id=(select auth.uid())));
create policy remove_collection_item on public.loox_collection_items for delete to authenticated using(exists(select 1 from public.loox_collections c where c.id=collection_id and c.user_id=(select auth.uid())));
create policy read_comments on public.loox_post_comments for select to anon,authenticated using(loox_private.public_post(post_id));
create policy write_comments on public.loox_post_comments for insert to authenticated with check(user_id=(select auth.uid()) and loox_private.public_post(post_id) and exists(select 1 from public.loox_community_posts p where p.id=post_id and comments_enabled));
create policy delete_comment on public.loox_post_comments for delete to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.loox_community_posts p where p.id=post_id and p.creator_id=(select auth.uid())));
create policy own_reports on public.loox_content_reports for select to authenticated using(user_id=(select auth.uid()));
create policy report_public on public.loox_content_reports for insert to authenticated with check(user_id=(select auth.uid()) and loox_private.public_post(post_id) and (comment_id is null or exists(select 1 from public.loox_post_comments c where c.id=comment_id and c.post_id=loox_content_reports.post_id)));
create policy own_notifications on public.loox_notifications for select to authenticated using(user_id=(select auth.uid()));
create policy read_notification on public.loox_notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

-- Serialize rate checks per account so parallel requests cannot bypass limits.
create function loox_private.social_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare n integer; cap integer;
begin
 if auth.uid() is null or auth.uid()<>new.user_id then raise exception 'Sign in to continue'; end if;
 perform pg_advisory_xact_lock(hashtext('social:'||new.user_id::text));
 if tg_table_name='loox_post_comments' then
  select count(*) into n from public.loox_post_comments where user_id=new.user_id and created_at>now()-interval '1 minute';cap:=6;
 elsif tg_table_name='loox_content_reports' then
  select count(*) into n from public.loox_content_reports where user_id=new.user_id and created_at>now()-interval '1 hour';cap:=10;
 elsif tg_table_name='loox_collections' then
  select count(*) into n from public.loox_collections where user_id=new.user_id;cap:=100;
 else
  select count(*) into n from public.loox_saved_posts where user_id=new.user_id;cap:=2000;
 end if;
 if n>=cap then raise exception 'Community limit reached. Please try again later.';end if;
 new.created_at:=now();return new;
end $$;
revoke all on function loox_private.social_guard() from public,anon,authenticated;
create trigger loox_comment_guard before insert on public.loox_post_comments for each row execute function loox_private.social_guard();
create trigger loox_report_guard before insert on public.loox_content_reports for each row execute function loox_private.social_guard();
create trigger loox_collection_guard before insert on public.loox_collections for each row execute function loox_private.social_guard();
create trigger loox_save_guard before insert on public.loox_saved_posts for each row execute function loox_private.social_guard();

create function loox_private.notify_social() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; actor uuid; post uuid; event text;
begin
 if tg_table_name='loox_creator_follows' then recipient:=new.creator_id;actor:=new.follower_id;event:='follow';
 else select creator_id into recipient from public.loox_community_posts where id=new.post_id;actor:=new.user_id;post:=new.post_id;event:=case when tg_table_name='loox_post_likes' then 'like' else 'comment' end;end if;
 if recipient=actor or not exists(select 1 from public.loox_creator_profiles where user_id=recipient and notifications_enabled) then return new;end if;
 -- Batch repeated engagement by this actor on this post/type within a day.
 perform pg_advisory_xact_lock(hashtext('notification:'||recipient::text));
 if not exists(select 1 from public.loox_notifications where user_id=recipient and actor_id=actor and kind=event and post_id is not distinct from post and created_at>now()-interval '1 day') then
 insert into public.loox_notifications(user_id,actor_id,kind,post_id) values(recipient,actor,event,post);end if;
 return new;
end $$;
revoke all on function loox_private.notify_social() from public,anon,authenticated;
create trigger loox_notify_like after insert on public.loox_post_likes for each row execute function loox_private.notify_social();
create trigger loox_notify_follow after insert on public.loox_creator_follows for each row execute function loox_private.notify_social();
create trigger loox_notify_comment after insert on public.loox_post_comments for each row execute function loox_private.notify_social();

create function public.loox_save_privacy(p_private boolean,p_hide_connections boolean,p_notifications boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to change privacy';end if;
 update public.loox_creator_profiles set is_private=coalesce(p_private,false),hide_connections=coalesce(p_hide_connections,false),notifications_enabled=coalesce(p_notifications,true) where user_id=auth.uid();
end $$;
revoke all on function public.loox_save_privacy(boolean,boolean,boolean) from public,anon;
grant execute on function public.loox_save_privacy(boolean,boolean,boolean) to authenticated;
create function public.loox_post_permissions(p_id uuid,p_comments boolean,p_remix boolean,p_download boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.loox_community_posts where id=p_id and creator_id=auth.uid()) then raise exception 'Post not found';end if;
 update public.loox_community_posts set comments_enabled=coalesce(p_comments,false),allow_remix=coalesce(p_remix,false),allow_download=coalesce(p_download,false) where id=p_id and creator_id=auth.uid();
end $$;
revoke all on function public.loox_post_permissions(uuid,boolean,boolean,boolean) from public,anon;
grant execute on function public.loox_post_permissions(uuid,boolean,boolean,boolean) to authenticated;

-- Keep the old signature so existing generator/community clients keep working.
create or replace function public.loox_sync_community_post() returns trigger language plpgsql security definer set search_path='' as $$
declare j public.loox_jobs;
begin
 select * into j from public.loox_jobs where id=new.job_id and user_id=new.user_id and state='succeeded';
 if j.result_path is null or j.result_path not like new.user_id::text||'/%' then return new;end if;
 insert into public.loox_creator_profiles(user_id,username) values(new.user_id,'creator_'||left(replace(new.user_id::text,'-',''),20)) on conflict(user_id) do nothing;
 insert into public.loox_community_posts(id,creator_id,job_id,media_path,media_type,caption,shared_prompt,status,visible,created_at,model_id)
 values(new.id,new.user_id,new.job_id,j.result_path,case when j.operation='generate_video' or j.operation like 'video_%' then 'video' else 'image' end,coalesce(nullif(new.caption,''),left(new.prompt,120)),case when new.share_prompt then new.prompt end,new.status,new.visible,new.submitted_at,j.operation)
 on conflict(id) do update set caption=excluded.caption,shared_prompt=excluded.shared_prompt,status=excluded.status,visible=excluded.visible,media_path=excluded.media_path,media_type=excluded.media_type,model_id=excluded.model_id;
 if tg_op='UPDATE' and old.status is distinct from new.status and new.status in ('approved','rejected') then
 insert into public.loox_notifications(user_id,kind,post_id) select new.user_id,new.status,new.id where exists(select 1 from public.loox_creator_profiles where user_id=new.user_id and notifications_enabled);
 end if;
 return new;
end $$;

create function public.loox_discover(p_kind text default 'all',p_sort text default 'latest',p_offset integer default 0,p_creator uuid default null,p_query text default '',p_collection uuid default null,p_days integer default 30) returns jsonb language sql stable security definer set search_path='' as $$
 with ranked as (
 select p.*,c.username,c.display_name,c.avatar_path,
 (select count(*) from public.loox_post_likes l where l.post_id=p.id) as likes,
 (select count(*) from public.loox_saved_posts s where s.post_id=p.id) as saves,
 (select count(*) from public.loox_post_comments m where m.post_id=p.id) as comments,
 exists(select 1 from public.loox_post_likes l where l.post_id=p.id and l.user_id=auth.uid()) as liked,
 exists(select 1 from public.loox_saved_posts s where s.post_id=p.id and s.user_id=auth.uid()) as saved
 from public.loox_community_posts p join public.loox_creator_profiles c on c.user_id=p.creator_id
 where loox_private.public_post(p.id) and (p_kind='all' or p.media_type=p_kind) and (p_creator is null or p.creator_id=p_creator)
 and (p_sort<>'following' or exists(select 1 from public.loox_creator_follows f where f.creator_id=p.creator_id and f.follower_id=auth.uid()))
 and (p_sort<>'saved' or exists(select 1 from public.loox_saved_posts s where s.post_id=p.id and s.user_id=auth.uid()))
 and (p_sort<>'liked' or exists(select 1 from public.loox_post_likes l where l.post_id=p.id and l.user_id=auth.uid()))
 and (p_sort<>'trending' or p.created_at>=now()-make_interval(days=>greatest(1,least(p_days,30))))
 and (p_collection is null or exists(select 1 from public.loox_collection_items i join public.loox_collections cl on cl.id=i.collection_id where i.post_id=p.id and cl.id=p_collection and (cl.user_id=auth.uid() or (cl.is_public and loox_private.public_creator(cl.user_id)))))
 and (coalesce(p_query,'')='' or position(lower(left(p_query,100)) in lower(p.caption||' '||c.username||' '||c.display_name||' '||coalesce(p.model_id,'')))>0)
 ), scored as (
 select *, (likes*2+(select count(*) from public.loox_saved_posts s where s.post_id=ranked.id and s.user_id<>ranked.creator_id)*3+(select count(distinct m.user_id) from public.loox_post_comments m where m.post_id=ranked.id and m.user_id<>ranked.creator_id))::numeric/power(2+greatest(0,extract(epoch from (now()-created_at))/3600),1.3) as trend from ranked
 ), page as (
 select * from scored order by case when p_sort='trending' then trend when p_sort='popular' then likes else 0 end desc,created_at desc,id limit 25 offset greatest(0,least(p_offset,10000))
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(t)-'trend') from(select * from page limit 24)t),'[]'::jsonb),'has_more',(select count(*)>24 from page));
$$;
revoke all on function public.loox_discover(text,text,integer,uuid,text,uuid,integer) from public;
grant execute on function public.loox_discover(text,text,integer,uuid,text,uuid,integer) to anon,authenticated;
create or replace function public.loox_community_feed(p_kind text default 'all',p_sort text default 'latest',p_offset integer default 0,p_creator uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 select public.loox_discover(p_kind,p_sort,p_offset,p_creator);
$$;
create or replace function public.loox_creator_summary(p_creator uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select (to_jsonb(c)-'notifications_enabled')||jsonb_build_object('posts',(select count(*) from public.loox_community_posts p where p.creator_id=c.user_id and loox_private.public_post(p.id)),
 'followers',(select count(*) from public.loox_creator_follows f where f.creator_id=c.user_id),'following',(select count(*) from public.loox_creator_follows f where f.follower_id=c.user_id),
 'followed',exists(select 1 from public.loox_creator_follows f where f.creator_id=c.user_id and f.follower_id=auth.uid()),'notifications_enabled',case when c.user_id=auth.uid() then c.notifications_enabled end)
 from public.loox_creator_profiles c where c.user_id=p_creator and (not c.is_private or c.user_id=auth.uid());
$$;

-- Create a creator identity at signup without touching wallet/onboarding logic.
create function loox_private.new_creator() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.loox_creator_profiles(user_id,username) values(new.id,'creator_'||left(replace(new.id::text,'-',''),20)) on conflict(user_id) do nothing;return new;
end $$;
revoke all on function loox_private.new_creator() from public,anon,authenticated;
create trigger loox_create_creator after insert on auth.users for each row execute function loox_private.new_creator();
insert into public.loox_creator_profiles(user_id,username) select id,'creator_'||left(replace(id::text,'-',''),20) from auth.users on conflict(user_id) do nothing;

create or replace function public.loox_publish_creation(p_job uuid,p_caption text,p_share_prompt boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.loox_jobs;s uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to publish';end if;
 perform pg_advisory_xact_lock(hashtext('publish:'||auth.uid()::text));
 if (select count(*) from public.loox_template_submissions where user_id=auth.uid() and submitted_at>now()-interval '1 hour')>=5 then raise exception 'Submission limit reached. Try again in an hour.';end if;
 select * into j from public.loox_jobs where id=p_job and user_id=auth.uid() and state='succeeded' and (operation='generate' or operation like 'generate_%' or operation like 'video_%');
 if j.id is null or j.prompt is null or j.result_path is null or j.result_path not like auth.uid()::text||'/%' then raise exception 'Completed creation not found';end if;
 insert into public.loox_template_submissions(user_id,job_id,prompt,caption,share_prompt,status) values(auth.uid(),j.id,j.prompt,trim(p_caption),coalesce(p_share_prompt,false),'pending') returning id into s;
 return s;
exception when unique_violation then raise exception 'This creation has already been submitted. Manage it from your profile.';
end $$;

create function loox_private.engagement_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid;n integer;
begin
 if tg_table_name='loox_creator_follows' then actor:=new.follower_id;else actor:=new.user_id;end if;
 if auth.uid() is null or actor<>auth.uid() then raise exception 'Sign in to continue';end if;
 perform pg_advisory_xact_lock(hashtext('engagement:'||actor::text));
 if tg_table_name='loox_creator_follows' then select count(*) into n from public.loox_creator_follows where follower_id=actor and created_at>now()-interval '1 minute';
 else select count(*) into n from public.loox_post_likes where user_id=actor and created_at>now()-interval '1 minute';end if;
 if n>=30 then raise exception 'Too many interactions. Please try again shortly.';end if;
 new.created_at:=now();return new;
end $$;
revoke all on function loox_private.engagement_guard() from public,anon,authenticated;
create trigger loox_like_guard before insert on public.loox_post_likes for each row execute function loox_private.engagement_guard();
create trigger loox_follow_guard before insert on public.loox_creator_follows for each row execute function loox_private.engagement_guard();
create function public.loox_public_post(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(p)||jsonb_build_object('username',c.username,'display_name',c.display_name,'avatar_path',c.avatar_path,
 'likes',(select count(*) from public.loox_post_likes l where l.post_id=p.id),
 'comments',(select count(*) from public.loox_post_comments m where m.post_id=p.id),
 'liked',exists(select 1 from public.loox_post_likes l where l.post_id=p.id and l.user_id=auth.uid()),
 'saved',exists(select 1 from public.loox_saved_posts s where s.post_id=p.id and s.user_id=auth.uid()))
 from public.loox_community_posts p join public.loox_creator_profiles c on c.user_id=p.creator_id where p.id=p_id and loox_private.public_post(p.id);
$$;
revoke all on function public.loox_public_post(uuid) from public;
grant execute on function public.loox_public_post(uuid) to anon,authenticated;

grant all on public.loox_saved_posts,public.loox_collections,public.loox_collection_items,public.loox_post_comments,public.loox_content_reports,public.loox_notifications,public.loox_moderation_log to service_role;
