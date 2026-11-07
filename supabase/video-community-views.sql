alter table public.loox_community_posts add column view_count bigint not null default 0 check(view_count>=0);
create table public.loox_post_views(post_id uuid not null references public.loox_community_posts(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,day date not null default ((now() at time zone 'UTC')::date),created_at timestamptz not null default now(),primary key(post_id,user_id,day));
create index loox_views_user on public.loox_post_views(user_id);
alter table public.loox_post_views enable row level security;
revoke all on public.loox_post_views from anon,authenticated;
grant all on public.loox_post_views to service_role;
create function loox_private.record_view(p_user uuid,p_post uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare counted integer;
begin
 if not exists(select 1 from public.loox_community_posts where id=p_post and media_type='video' and creator_id<>p_user and loox_private.public_post(id)) then raise exception 'Public video not found';end if;
 insert into public.loox_post_views(user_id,post_id) values(p_user,p_post) on conflict do nothing;
 get diagnostics counted=row_count;
 if counted=1 then update public.loox_community_posts set view_count=view_count+1 where id=p_post;end if;
 return (select view_count from public.loox_community_posts where id=p_post);
end $$;
revoke all on function loox_private.record_view(uuid,uuid) from public,anon,authenticated;
grant execute on function loox_private.record_view(uuid,uuid) to service_role;
create function public.loox_record_view(p_user uuid,p_post uuid) returns bigint language sql security invoker set search_path='' as $$select loox_private.record_view(p_user,p_post)$$;
revoke all on function public.loox_record_view(uuid,uuid) from public,anon,authenticated;
grant execute on function public.loox_record_view(uuid,uuid) to service_role;
create or replace function loox_private.loox_creator_summary(p_creator uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select (to_jsonb(c)-'notifications_enabled')||jsonb_build_object('posts',(select count(*) from public.loox_community_posts p where p.creator_id=c.user_id and loox_private.public_post(p.id)),
 'total_views',(select coalesce(sum(view_count),0) from public.loox_community_posts p where p.creator_id=c.user_id and loox_private.public_post(p.id)),
 'followers',(select count(*) from public.loox_creator_follows f where f.creator_id=c.user_id),'following',(select count(*) from public.loox_creator_follows f where f.follower_id=c.user_id),
 'followed',exists(select 1 from public.loox_creator_follows f where f.creator_id=c.user_id and f.follower_id=auth.uid()),'notifications_enabled',case when c.user_id=auth.uid() then c.notifications_enabled end)
 from public.loox_creator_profiles c where c.user_id=p_creator and (not c.is_private or c.user_id=auth.uid());
$$;
grant usage on schema loox_private to service_role;
