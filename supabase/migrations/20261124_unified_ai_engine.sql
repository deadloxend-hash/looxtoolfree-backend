begin;
-- Additive, service-only control and prediction records. Existing prices and balances are unchanged.
create table public.loox_engine_config(
 id boolean primary key default true check(id),enabled boolean not null default false,
 proposed_monthly_millicents bigint not null default 10000000 check(proposed_monthly_millicents>0),
 user_daily_millicents bigint check(user_daily_millicents>0),user_monthly_millicents bigint check(user_monthly_millicents>0),
 max_concurrent integer not null default 2 check(max_concurrent between 1 and 20)
);
insert into public.loox_engine_config(id) values(true);
create table public.loox_engine_models(
 id text primary key,model_id text,enabled boolean not null default false,minimum_plan text not null default 'pro' check(minimum_plan in ('creator','pro')),
 schema jsonb,pricing jsonb,pricing_verified_at timestamptz,pricing_source text,schema_version text,schema_verified_at timestamptz,acceptance_verified_at timestamptz,
 daily_millicents bigint check(daily_millicents>0),monthly_millicents bigint check(monthly_millicents>0),
 maximum_millicents bigint check(maximum_millicents>0),max_concurrent integer not null default 1 check(max_concurrent between 1 and 10)
);
create table public.loox_engine_jobs(
 job_id uuid primary key references public.loox_jobs on delete restrict,user_id uuid not null references public.loox_profiles on delete restrict,
 model_id text not null references public.loox_engine_models,request_id uuid not null,
 prediction_id text unique,status text not null default 'reserved' check(status in ('reserved','submitting','processing','uncertain','succeeded','failed')),
 reserved_millicents bigint not null check(reserved_millicents>0),started_at timestamptz,finished_at timestamptz,created_at timestamptz not null default now(),
 unique(user_id,request_id)
);
create index loox_engine_jobs_model_time on public.loox_engine_jobs(model_id,created_at);
alter table public.loox_engine_config enable row level security;
alter table public.loox_engine_models enable row level security;
alter table public.loox_engine_jobs enable row level security;
revoke all on public.loox_engine_config,public.loox_engine_models,public.loox_engine_jobs from public,anon,authenticated;
grant select,insert,update on public.loox_engine_config,public.loox_engine_models,public.loox_engine_jobs to service_role;
insert into public.loox_operations(id,cost,max_millicents) select 'generate_flux_schnell_paid',cost,max_millicents from public.loox_operations where id='generate' on conflict(id) do nothing;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('google_nano_2','google/nano-banana-2','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/nano-banana-2' from public.loox_operations where id='generate_google_nano_2' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('google_nano_pro','google/nano-banana-pro','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/nano-banana-pro' from public.loox_operations where id='generate_google_nano_pro' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('bfl_flux2_pro','black-forest-labs/flux-2-pro','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','black-forest-labs/flux-2-pro' from public.loox_operations where id='generate_bfl_flux2_pro' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('bfl_klein_4b','black-forest-labs/flux-2-klein-4b','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','black-forest-labs/flux-2-klein-4b' from public.loox_operations where id='generate_bfl_klein_4b' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('ideogram_p_image','prunaai/p-image-ideogram','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','prunaai/p-image-ideogram' from public.loox_operations where id='generate_ideogram_p_image' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('ideogram_45','ideogram-ai/ideogram-4-5','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','ideogram-ai/ideogram-4-5' from public.loox_operations where id='generate_ideogram_45' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('stability_sd35','stability-ai/stable-diffusion-3.5-large','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','stability-ai/stable-diffusion-3.5-large' from public.loox_operations where id='generate_stability_sd35' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('stability_ultra',null,'pro');
insert into public.loox_engine_models(id,model_id,minimum_plan) values('byteplus_45','bytedance/seedream-4.5','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','bytedance/seedream-4.5' from public.loox_operations where id='generate_byteplus_45' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('byteplus_50_flash',null,'pro');
insert into public.loox_engine_models(id,model_id,minimum_plan) values('openai_gpt_image','openai/gpt-image-2.5-flare','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','openai/gpt-image-2.5-flare' from public.loox_operations where id='generate_openai_gpt_image' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('z_image_turbo',null,'pro');
insert into public.loox_engine_models(id,model_id,minimum_plan) values('replicate_qwen2','qwen/qwen-image-2','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','qwen/qwen-image-2' from public.loox_operations where id='generate_replicate_qwen2' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('replicate_hidream','prunaai/hidream-l1-fast','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','prunaai/hidream-l1-fast' from public.loox_operations where id='generate_replicate_hidream' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('replicate_imagen4','google/imagen-4-fast','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/imagen-4-fast' from public.loox_operations where id='generate_replicate_imagen4' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('replicate_photon','luma/photon','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','luma/photon' from public.loox_operations where id='generate_replicate_photon' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('replicate_flux_ultra','black-forest-labs/flux-1.1-pro-ultra','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','black-forest-labs/flux-1.1-pro-ultra' from public.loox_operations where id='generate_replicate_flux_ultra' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('wan22_i2v_fast','wan-video/wan-2.2-i2v-fast','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','wan-video/wan-2.2-i2v-fast' from public.loox_operations where id='video_wan22_i2v_fast' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('wan22_5b_fast','wan-video/wan-2.2-5b-fast','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','wan-video/wan-2.2-5b-fast' from public.loox_operations where id='video_wan22_5b_fast' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('wan22_t2v_fast','wan-video/wan-2.2-t2v-fast','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','wan-video/wan-2.2-t2v-fast' from public.loox_operations where id='video_wan22_t2v_fast' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('wan25_i2v','wan-video/wan-2.5-i2v','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','wan-video/wan-2.5-i2v' from public.loox_operations where id='video_wan25_i2v_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','wan-video/wan-2.5-i2v' from public.loox_operations where id='video_wan25_i2v_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('wan26_i2v_flash','wan-video/wan2.6-i2v-flash','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','wan-video/wan2.6-i2v-flash' from public.loox_operations where id='video_wan26_i2v_flash_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','wan-video/wan2.6-i2v-flash' from public.loox_operations where id='video_wan26_i2v_flash_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('kling_30','kwaivgi/kling-v3-video','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','kwaivgi/kling-v3-video' from public.loox_operations where id='video_kling_30_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','kwaivgi/kling-v3-video' from public.loox_operations where id='video_kling_30_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('seedance_20','bytedance/seedance-2.0','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','bytedance/seedance-2.0' from public.loox_operations where id='video_seedance_20_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','bytedance/seedance-2.0' from public.loox_operations where id='video_seedance_20_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('veo_31_fast','google/veo-3.1-fast','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/veo-3.1-fast' from public.loox_operations where id='video_veo_31_fast_4' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/veo-3.1-fast' from public.loox_operations where id='video_veo_31_fast_6' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/veo-3.1-fast' from public.loox_operations where id='video_veo_31_fast_8' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('runway_45','runwayml/gen-4.5','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','runwayml/gen-4.5' from public.loox_operations where id='video_runway_45_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','runwayml/gen-4.5' from public.loox_operations where id='video_runway_45_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('flux3_video',null,'pro');
insert into public.loox_engine_models(id,model_id,minimum_plan) values('kling_40','kwaivgi/kling-v4.0','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','kwaivgi/kling-v4.0' from public.loox_operations where id='video_kling_40_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','kwaivgi/kling-v4.0' from public.loox_operations where id='video_kling_40_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('kling_40_flash','kwaivgi/kling-v4-flash','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','kwaivgi/kling-v4-flash' from public.loox_operations where id='video_kling_40_flash_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','kwaivgi/kling-v4-flash' from public.loox_operations where id='video_kling_40_flash_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('seedance_25','bytedance/seedance-2.5','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','bytedance/seedance-2.5' from public.loox_operations where id='video_seedance_25_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','bytedance/seedance-2.5' from public.loox_operations where id='video_seedance_25_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('seedance_20_fast','bytedance/seedance-2.0-fast','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','bytedance/seedance-2.0-fast' from public.loox_operations where id='video_seedance_20_fast_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','bytedance/seedance-2.0-fast' from public.loox_operations where id='video_seedance_20_fast_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('grok_video','xai/grok-imagine-video','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','xai/grok-imagine-video' from public.loox_operations where id='video_grok_video_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','xai/grok-imagine-video' from public.loox_operations where id='video_grok_video_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('veo_31','google/veo-3.1','pro');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/veo-3.1' from public.loox_operations where id='video_veo_31_4' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/veo-3.1' from public.loox_operations where id='video_veo_31_6' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/veo-3.1' from public.loox_operations where id='video_veo_31_8' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('veo_31_lite','google/veo-3.1-lite','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/veo-3.1-lite' from public.loox_operations where id='video_veo_31_lite_4' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/veo-3.1-lite' from public.loox_operations where id='video_veo_31_lite_6' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','google/veo-3.1-lite' from public.loox_operations where id='video_veo_31_lite_8' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('minimax_h3','minimax/h3','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','minimax/h3' from public.loox_operations where id='video_minimax_h3_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','minimax/h3' from public.loox_operations where id='video_minimax_h3_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('minimax_h3_lite','minimax/h3-lite','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','minimax/h3-lite' from public.loox_operations where id='video_minimax_h3_lite_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','minimax/h3-lite' from public.loox_operations where id='video_minimax_h3_lite_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('wan_30','alibaba/wan-3','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','alibaba/wan-3' from public.loox_operations where id='video_wan_30_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','alibaba/wan-3' from public.loox_operations where id='video_wan_30_10' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('luma_ray2','luma/ray-2-720p','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','luma/ray-2-720p' from public.loox_operations where id='video_luma_ray2_5' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','luma/ray-2-720p' from public.loox_operations where id='video_luma_ray2_9' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
insert into public.loox_engine_models(id,model_id,minimum_plan) values('sora_2',null,'pro');
insert into public.loox_engine_models(id,model_id,minimum_plan) values('flux_schnell_fallback','black-forest-labs/flux-schnell','creator');
insert into public.loox_provider_operations(operation,provider,model_id) select id,'replicate','black-forest-labs/flux-schnell' from public.loox_operations where id='generate_flux_schnell_paid' on conflict(operation) do update set provider=excluded.provider,model_id=excluded.model_id;
create function public.loox_engine_reserve(p_user uuid,p_request uuid,p_digest text,p_model text,p_operation text,p_credits integer,p_estimate bigint,p_budget bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.loox_engine_config;m public.loox_engine_models;cap public.loox_provider_limits;j jsonb;prior public.loox_engine_jobs;planned bigint;spent bigint;
begin
 -- Same wallet -> provider lock order as existing financial reservations.
 perform 1 from public.loox_wallets where user_id=p_user for update;
 select * into strict cap from public.loox_provider_limits where provider='replicate' for update;
 select * into prior from public.loox_engine_jobs where user_id=p_user and request_id=p_request;
 if found then return public.loox_reserve_quoted(p_user,p_request,p_digest,p_operation,1000000000,p_budget,p_credits);end if;
 select * into strict c from public.loox_engine_config where id;
 select * into strict m from public.loox_engine_models where id=p_model;
 if not c.enabled or not cap.enabled or not m.enabled or m.model_id is null or m.schema_verified_at is null or m.schema_verified_at<now()-interval '31 days' or c.user_daily_millicents is null or c.user_monthly_millicents is null or m.daily_millicents is null or m.monthly_millicents is null or m.maximum_millicents is null then raise exception 'budget_limit';end if;
 if p_estimate is null or p_estimate<=0 or not exists(select 1 from public.loox_provider_operations where operation=p_operation and provider='replicate' and model_id=m.model_id) then raise exception 'budget_limit';end if;
 select greatest(max_millicents,p_estimate) into strict planned from public.loox_operations where id=p_operation;
 if planned>least(m.maximum_millicents,cap.per_generation_millicents,(select operation_max_millicents from public.loox_cost_controls where id)) then raise exception 'budget_limit';end if;
 select coalesce(sum(greatest(estimated_millicents,coalesce(actual_millicents,0))),0) into spent from public.loox_provider_costs where provider='replicate' and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if spent+planned>cap.daily_millicents then raise exception 'budget_limit';end if;
 select coalesce(sum(greatest(estimated_millicents,coalesce(actual_millicents,0))),0) into spent from public.loox_provider_costs where provider='replicate' and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 if spent+planned>least(cap.monthly_millicents,c.proposed_monthly_millicents) then raise exception 'budget_limit';end if;
 select coalesce(sum(greatest(pc.estimated_millicents,coalesce(pc.actual_millicents,0))),0) into spent from public.loox_provider_costs pc join public.loox_jobs j on j.id=pc.job_id where j.user_id=p_user and pc.provider='replicate' and pc.created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if spent+planned>c.user_daily_millicents then raise exception 'budget_limit';end if;
 select coalesce(sum(greatest(pc.estimated_millicents,coalesce(pc.actual_millicents,0))),0) into spent from public.loox_provider_costs pc join public.loox_jobs j on j.id=pc.job_id where j.user_id=p_user and pc.provider='replicate' and pc.created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 if spent+planned>c.user_monthly_millicents then raise exception 'budget_limit';end if;
 select coalesce(sum(greatest(pc.estimated_millicents,coalesce(pc.actual_millicents,0))),0) into spent from public.loox_provider_costs pc join public.loox_engine_jobs e on e.job_id=pc.job_id where e.model_id=p_model and pc.created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if spent+planned>m.daily_millicents then raise exception 'budget_limit';end if;
 select coalesce(sum(greatest(pc.estimated_millicents,coalesce(pc.actual_millicents,0))),0) into spent from public.loox_provider_costs pc join public.loox_engine_jobs e on e.job_id=pc.job_id where e.model_id=p_model and pc.created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
 if spent+planned>m.monthly_millicents then raise exception 'budget_limit';end if;
 if (select count(*) from public.loox_engine_jobs where status in ('reserved','submitting','processing','uncertain'))>=c.max_concurrent or (select count(*) from public.loox_engine_jobs where model_id=p_model and status in ('reserved','submitting','processing','uncertain'))>=m.max_concurrent then raise exception 'jobs_in_progress';end if;
 j=public.loox_reserve_quoted(p_user,p_request,p_digest,p_operation,1000000000,p_budget,p_credits);
 if not (j->>'fresh')::boolean then return j;end if;
 update public.loox_provider_costs set estimated_millicents=planned where job_id=(j->>'id')::uuid;
 if not found then raise exception 'budget_accounting_unavailable';end if;
 insert into public.loox_engine_jobs(job_id,user_id,model_id,request_id,reserved_millicents) values((j->>'id')::uuid,p_user,p_model,p_request,planned);
 return j;
end $$;
create function public.loox_engine_claim(p_job uuid) returns boolean language plpgsql set search_path='' as $$begin update public.loox_engine_jobs set status='submitting',started_at=now() where job_id=p_job and status='reserved';return found;end$$;
create function public.loox_engine_bind(p_job uuid,p_prediction text) returns void language plpgsql set search_path='' as $$begin
 if p_prediction !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'Invalid prediction';end if;
 update public.loox_engine_jobs set prediction_id=p_prediction,status=case when status in ('succeeded','failed') then status else 'processing' end where job_id=p_job and (prediction_id is null or prediction_id=p_prediction);
 if not found then raise exception 'Prediction conflict';end if;
end$$;
create function public.loox_engine_uncertain(p_job uuid) returns void language sql set search_path='' as $$update public.loox_engine_jobs set status='uncertain' where job_id=p_job and status='submitting'$$;
create function public.loox_engine_failed(p_job uuid) returns void language plpgsql set search_path='' as $$begin
 perform 1 from public.loox_jobs where id=p_job for update;
 perform public.loox_finish(p_job,null);
 update public.loox_engine_jobs set status=case when exists(select 1 from public.loox_jobs where id=p_job and state='succeeded') then 'succeeded' else 'failed' end,finished_at=now() where job_id=p_job;
 -- Financial liability remains reserved until an invoice confirms the charge, even on failure.
end$$;
create function public.loox_engine_completed(p_job uuid,p_seconds double precision) returns void language plpgsql set search_path='' as $$begin
 update public.loox_engine_jobs set status='succeeded',finished_at=now() where job_id=p_job and exists(select 1 from public.loox_jobs where id=p_job and state='succeeded');
 update public.loox_provider_costs set predict_seconds=p_seconds,provider_status='succeeded' where job_id=p_job;
 update public.loox_engine_models set acceptance_verified_at=now() where id=(select model_id from public.loox_engine_jobs where job_id=p_job and status='succeeded');
end$$;
create function public.loox_engine_invoice(p_job uuid,p_actual bigint,p_reference text) returns void language plpgsql set search_path='' as $$declare c public.loox_provider_costs;begin
 perform 1 from public.loox_provider_limits where provider='replicate' for update;
 select * into strict c from public.loox_provider_costs where job_id=p_job for update;
 if p_actual<0 or p_actual is null or length(p_reference)<3 or length(p_reference)>160 then raise exception 'Invalid reconciliation';end if;
 if c.billing_reference is not null and (c.billing_reference<>p_reference or c.actual_millicents<>p_actual) then raise exception 'Reconciliation conflict';end if;
 update public.loox_provider_costs set actual_millicents=p_actual,billing_reference=p_reference,reconciled_at=now() where job_id=p_job;
 if p_actual>c.estimated_millicents then update public.loox_provider_limits set enabled=false where provider='replicate';perform public.loox_security_incident('engine-invoice-overrun','ai_spending','high','generation');end if;
end$$;
create function public.loox_engine_model_stats() returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
 select e.model_id id,count(*) total,count(*) filter(where j.state='succeeded') succeeded,count(*) filter(where j.state='failed') failed,
 sum(pc.estimated_millicents) estimated_millicents,sum(pc.actual_millicents) actual_millicents,
 count(*) filter(where pc.actual_millicents is null) unreconciled,
 avg(pc.predict_seconds) average_seconds,max(e.finished_at) filter(where j.state='succeeded') last_success
 from public.loox_engine_jobs e join public.loox_jobs j on j.id=e.job_id left join public.loox_provider_costs pc on pc.job_id=e.job_id group by e.model_id
 ) x
$$;
create function public.loox_engine_spending_health() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('day',coalesce((select sum(greatest(estimated_millicents,coalesce(actual_millicents,0))) from public.loox_provider_costs where provider='replicate' and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0),
 'month',coalesce((select sum(greatest(estimated_millicents,coalesce(actual_millicents,0))) from public.loox_provider_costs where provider='replicate' and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0),
 'daily_limit',(select daily_millicents from public.loox_provider_limits where provider='replicate'),
 'monthly_limit',(select least(p.monthly_millicents,c.proposed_monthly_millicents) from public.loox_provider_limits p cross join public.loox_engine_config c where p.provider='replicate'))
$$;
do $$declare p record;begin for p in select proc.oid::regprocedure as fn from pg_proc proc join pg_namespace n on n.oid=proc.pronamespace where n.nspname='public' and proc.proname like 'loox_engine_%' loop execute format('revoke all on function %s from public,anon,authenticated',p.fn);execute format('grant execute on function %s to service_role',p.fn);end loop;end$$;
commit;
