begin;
alter table public.loox_template_catalog add column archived_at timestamptz;
alter table public.loox_provider_limits drop constraint loox_provider_limits_provider_check;
alter table public.loox_provider_limits add constraint loox_provider_limits_provider_check check(provider in ('google','bfl','ideogram','stability','byteplus','openai','replicate'));
-- Match accounting routes to the provider actually called by the existing adapters.
insert into public.loox_provider_limits(provider,daily_millicents,monthly_millicents,per_generation_millicents,enabled)
select provider,50000,500000,50000,true from unnest(array['google','bfl','ideogram','stability','byteplus','openai','replicate']) provider
on conflict(provider) do nothing;
insert into public.loox_provider_operations(operation,provider,model_id)
select v.operation,v.provider,v.model_id from (values
('generate_google_nano_2','google','gemini-3.1-flash-image'),('generate_google_nano_pro','google','gemini-3-pro-image'),
('generate_bfl_flux2_pro','bfl','flux-2-pro'),('generate_bfl_klein_4b','bfl','flux-2-klein-4b'),
('generate_ideogram_p_image','ideogram','p-image-ideogram'),('generate_ideogram_45','ideogram','ideogram-4-5'),
('generate_stability_sd35','stability','sd3.5-large'),('generate_stability_ultra','stability','ultra'),
('generate_byteplus_45','byteplus','seedream-4-5-251128'),('generate_byteplus_50_flash','byteplus','dola-seedream-5-0-flash-260915'),
('generate_openai_gpt_image','openai','gpt-image-2.5-flare'),
('generate_replicate_qwen2','replicate','qwen/qwen-image-2'),('generate_replicate_hidream','replicate','prunaai/hidream-l1-fast'),
('generate_replicate_imagen4','replicate','google/imagen-4-fast'),('generate_replicate_photon','replicate','luma/photon'),
('generate_replicate_flux_ultra','replicate','black-forest-labs/flux-1.1-pro-ultra')) as v(operation,provider,model_id)
join public.loox_operations o on o.id=v.operation
on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
create or replace function public.loox_control_manage(p_actor uuid,p_action text,p_target text,p_reason text,p_request uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare permission text; prior public.loox_admin_audit; ids text[]; old_data jsonb; affected integer;
begin
 permission:=case when p_action='provider_limit' then 'finance' when p_action in ('template_state','taxonomy_delete') then 'templates' when p_action='report_resolve' then 'moderation' else null end;
 if permission is null or not public.loox_control_permission(p_actor,permission) then raise exception 'Permission denied';end if;
 if coalesce(length(trim(p_reason)),0) not between 5 and 500 or p_request is null then raise exception 'A written reason and request ID are required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.loox_admin_audit where request_id=p_request;
 if found then
 if prior.actor<>p_actor or prior.action<>p_action or prior.target<>p_target or prior.reason<>trim(p_reason) or prior.detail->'input'<>p_data then raise exception 'Idempotency conflict';end if;
 return jsonb_build_object('saved',true,'duplicate',true);end if;
 if p_action='provider_limit' then
 if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' or coalesce((p_data->>'daily')::bigint,0) not between 1000 and 1000000 or coalesce((p_data->>'monthly')::bigint,0) not between 1000 and 10000000 or coalesce((p_data->>'maximum')::bigint,0) not between 1000 and 1000000 or (p_data->>'daily')::bigint>(p_data->>'monthly')::bigint or (p_data->>'maximum')::bigint>(p_data->>'daily')::bigint then raise exception 'Invalid provider budget';end if;
 select to_jsonb(l) into strict old_data from public.loox_provider_limits l where provider=p_target for update;
 update public.loox_provider_limits set daily_millicents=(p_data->>'daily')::bigint,monthly_millicents=(p_data->>'monthly')::bigint,per_generation_millicents=(p_data->>'maximum')::bigint,enabled=(p_data->>'enabled')::boolean where provider=p_target;
 elsif p_action='template_state' then
 if p_data->>'state' not in ('archive','restore','publish','unpublish') or jsonb_typeof(p_data->'ids') is distinct from 'array' or jsonb_array_length(p_data->'ids') not between 1 and 25 then raise exception 'Invalid template selection';end if;
 ids:=array(select distinct jsonb_array_elements_text(p_data->'ids'));
 perform id from public.loox_template_catalog where id=any(ids) for update;
 select jsonb_agg(jsonb_build_object('id',id,'active',active,'archived_at',archived_at)) into old_data from public.loox_template_catalog where id=any(ids);
 if jsonb_array_length(old_data) is distinct from array_length(ids,1) then raise exception 'Template not found';end if;
 if p_data->>'state'='publish' and exists(select 1 from public.loox_template_catalog where id=any(ids) and (archived_at is not null or coalesce(media_path,'')='' or coalesce(prompt,'')='')) then raise exception 'Restore the template and add media before publishing';end if;
 update public.loox_template_catalog set active=case when p_data->>'state'='publish' then true else false end,
 archived_at=case when p_data->>'state'='archive' then now() when p_data->>'state'='restore' then null else archived_at end,updated_at=now() where id=any(ids);
 elsif p_action='report_resolve' then
 if p_data->>'status' not in ('resolved','dismissed') then raise exception 'Invalid report status';end if;
 select to_jsonb(r) into old_data from public.loox_content_reports r where id=p_target::uuid and status='open' for update;
 if not found then raise exception 'Report is no longer open';end if;
 update public.loox_content_reports set status=p_data->>'status' where id=p_target::uuid;
 elsif p_action='taxonomy_delete' then
 if p_data->>'kind'='category' then
 if exists(select 1 from public.loox_template_catalog where category=p_target) then raise exception 'Category is still assigned to templates';end if;
 delete from public.loox_template_categories where name=p_target;
 elsif p_data->>'kind'='style' then
 if exists(select 1 from public.loox_template_catalog where style=p_target or p_target=any(styles)) then raise exception 'Style is still assigned to templates';end if;
 delete from public.loox_template_styles where name=p_target;
 else raise exception 'Invalid category or style';end if;
 end if;
 insert into public.loox_admin_audit(actor,action,target,reason,request_id,detail) values(p_actor,p_action,p_target,trim(p_reason),p_request,jsonb_build_object('input',p_data,'before',old_data));
 return jsonb_build_object('saved',true);
end$$;
revoke all on function public.loox_control_manage(uuid,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.loox_control_manage(uuid,text,text,text,uuid,jsonb) to service_role;
commit;
