-- Conservative upload gate. Existing objects and user files remain untouched.
create function loox_private.avatar_quota(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with owned as(select metadata from storage.objects where bucket_id='loox-avatars' and (storage.foldername(name))[1]=p_user::text),
 total as(select coalesce(sum((metadata->>'size')::bigint),0) as bytes from storage.objects where bucket_id='loox-avatars')
 select jsonb_build_object('allowed',(select count(*)<20 and coalesce(sum((metadata->>'size')::bigint),0)<5242880 from owned) and (select bytes<104857600 from total),'per_account_objects',20,'per_account_bytes',5242880,'bucket_bytes',104857600);
$$;
revoke all on function loox_private.avatar_quota(uuid) from public,anon,authenticated;
grant execute on function loox_private.avatar_quota(uuid) to service_role;
create function public.loox_avatar_quota(p_user uuid) returns jsonb language sql stable security invoker set search_path='' as $$select loox_private.avatar_quota(p_user)$$;
revoke all on function public.loox_avatar_quota(uuid) from public,anon,authenticated;
grant execute on function public.loox_avatar_quota(uuid) to service_role;
-- Avatar uploads now go through the authenticated image-decoding backend.
-- Prevent direct Storage API writes from bypassing type/size/quota validation.
drop policy if exists upload_own_avatar on storage.objects;
