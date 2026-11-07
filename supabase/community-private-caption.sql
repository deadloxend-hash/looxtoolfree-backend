-- Never populate a public caption from an unshared private prompt.
create or replace function public.loox_sync_community_post() returns trigger language plpgsql security definer set search_path='' as $$
declare j public.loox_jobs;
begin
 select * into j from public.loox_jobs where id=new.job_id and user_id=new.user_id and state='succeeded';
 if j.result_path is null or j.result_path not like new.user_id::text||'/%' then return new;end if;
 insert into public.loox_creator_profiles(user_id,username) values(new.user_id,'creator_'||left(replace(new.user_id::text,'-',''),20)) on conflict(user_id) do nothing;
 insert into public.loox_community_posts(id,creator_id,job_id,media_path,media_type,caption,shared_prompt,status,visible,created_at,model_id)
 values(new.id,new.user_id,new.job_id,j.result_path,case when j.operation='generate_video' or j.operation like 'video_%' then 'video' else 'image' end,coalesce(nullif(new.caption,''),case when new.share_prompt then left(new.prompt,120) else 'Untitled creation' end),case when new.share_prompt then new.prompt end,new.status,new.visible,new.submitted_at,j.operation)
 on conflict(id) do update set caption=excluded.caption,shared_prompt=excluded.shared_prompt,status=excluded.status,visible=excluded.visible,media_path=excluded.media_path,media_type=excluded.media_type,model_id=excluded.model_id;
 if tg_op='UPDATE' and old.status is distinct from new.status and new.status in ('approved','rejected') then
 insert into public.loox_notifications(user_id,kind,post_id) select new.user_id,new.status,new.id where exists(select 1 from public.loox_creator_profiles where user_id=new.user_id and notifications_enabled);
 end if;
 return new;
end $$;

