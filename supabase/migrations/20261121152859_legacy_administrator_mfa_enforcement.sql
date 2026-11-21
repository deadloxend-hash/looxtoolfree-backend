-- PREPARED FOR OWNER APPROVAL. Not applied by this release.
-- Requiring AAL2 can interrupt legacy direct administrator uploads/reviews.
-- Confirm a working authenticator sign-in before applying in production.
begin;
alter policy loox_admin_template_upload on storage.objects to authenticated
with check (
 bucket_id='loox-templates'
 and coalesce(auth.jwt()->'app_metadata'->>'loox_template_admin','false')='true'
 and auth.jwt()->>'aal'='aal2'
);
alter policy loox_admin_template_remove on storage.objects to authenticated
using (
 bucket_id='loox-templates'
 and coalesce(auth.jwt()->'app_metadata'->>'loox_template_admin','false')='true'
 and auth.jwt()->>'aal'='aal2'
);
-- Keep public and owner access; only the privileged administrator branch gains MFA.
alter policy consented_community_media on storage.objects to anon,authenticated
using (
 bucket_id='loox-results'
 and exists (
  select 1 from public.loox_community_posts p
  where p.media_path=objects.name
  and (
   loox_private.public_post(p.id)
   or p.creator_id=auth.uid()
   or (coalesce(auth.jwt()->'app_metadata'->>'loox_template_admin','false')='true' and auth.jwt()->>'aal'='aal2')
  )
 )
);
create or replace function loox_private.loox_review_creation(p_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $function$
begin
 if auth.uid() is null
 or not exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'loox_template_admin'='true')
 or coalesce(auth.jwt()->>'aal','')<>'aal2'
 then raise exception 'Administrator access and authenticator verification required'; end if;
 if p_status not in ('approved','rejected') then raise exception 'Invalid review'; end if;
 update public.loox_template_submissions set status=p_status,reviewed_at=now(),reviewed_by=auth.uid()
 where id=p_id and status='pending';
 if not found then raise exception 'Submission no longer pending'; end if;
end $function$;
commit;
