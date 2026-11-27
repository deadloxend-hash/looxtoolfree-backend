revoke execute on function public.loox_finish_media(uuid,text,text,text,text,bigint,text) from public,anon,authenticated;
revoke execute on function public.loox_local_complete_media(uuid,uuid,text,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.loox_finish_media(uuid,text,text,text,text,bigint,text) to service_role;
grant execute on function public.loox_local_complete_media(uuid,uuid,text,text,text,text,bigint,text) to service_role;