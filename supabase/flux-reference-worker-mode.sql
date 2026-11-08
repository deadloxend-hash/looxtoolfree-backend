-- Add optional capability flag for the private FLUX reference-image worker.
create or replace function public.loox_local_ping(p_modes text[]) returns void language plpgsql set search_path='' as $$
begin
 insert into public.loox_local_worker_health(id,modes,last_seen)
 values(1,array(select distinct m from unnest(p_modes) m where m in ('generate','generate_reference','generate_video','face_swap')),now())
 on conflict(id) do update set modes=excluded.modes,last_seen=excluded.last_seen;
end $$;
revoke all on function public.loox_local_ping(text[]) from public,anon,authenticated;
grant execute on function public.loox_local_ping(text[]) to service_role;
