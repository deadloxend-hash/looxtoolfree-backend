-- Z-Image Turbo local worker + Replicate fallback operations.
-- Applied to the connected LOOX Supabase project on 2026-11-08.
alter table public.loox_local_queue drop constraint if exists loox_local_queue_operation_check;
alter table public.loox_local_queue add constraint loox_local_queue_operation_check
 check (operation in ('generate','generate_z_image','generate_video','face_swap'));
insert into public.loox_operations(id,cost,max_millicents)
 values ('generate_z_image',3,1000),('generate_z_image_turbo',3,1000)
 on conflict(id) do nothing;
create or replace function public.loox_local_ping(p_modes text[]) returns void
 language plpgsql set search_path='' as $$
begin
 insert into public.loox_local_worker_health(id,modes,last_seen)
 values(1,array(select distinct m from unnest(p_modes) m where m in
  ('generate','generate_z_image','generate_reference','generate_video','face_swap')),now())
 on conflict(id) do update set modes=excluded.modes,last_seen=excluded.last_seen;
end $$;
revoke all on function public.loox_local_ping(text[]) from public,anon,authenticated;
grant execute on function public.loox_local_ping(text[]) to service_role;
