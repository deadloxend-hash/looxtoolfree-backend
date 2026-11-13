begin;
-- Historical Lifetime rows remain for existing invoices/refunds; no new sales.
insert into public.loox_plans(id,price_cents,credits,cadence) values
 ('creator',1200,100,'month'),('creator_yearly',12000,1200,'year'),
 ('pro',2900,250,'month'),('pro_yearly',29000,3000,'year')
on conflict(id) do update set price_cents=excluded.price_cents,credits=excluded.credits,cadence=excluded.cadence;
update public.loox_plans set credits=10 where id='free';

insert into public.loox_operations(id,cost,max_millicents) values
 ('video_kling_40_5',24,94200),
 ('video_kling_40_10',48,188400),
 ('video_kling_40_flash_5',15,56400),
 ('video_kling_40_flash_10',29,112800),
 ('video_seedance_25_5',35,138720),
 ('video_seedance_25_10',70,277440),
 ('video_seedance_20_fast_5',38,150000),
 ('video_seedance_20_fast_10',75,300000),
 ('video_grok_video_5',11,42001),
 ('video_grok_video_10',22,84001),
 ('video_veo_31_4',48,192000),
 ('video_veo_31_6',73,288001),
 ('video_veo_31_8',96,384000),
 ('video_minimax_h3_5',12,48000),
 ('video_minimax_h3_10',24,96000),
 ('video_minimax_h3_lite_5',6,24000),
 ('video_minimax_h3_lite_10',12,48000),
 ('video_veo_31_lite_4',6,24000),
 ('video_veo_31_lite_6',10,36001),
 ('video_veo_31_lite_8',12,48000),
 ('video_wan_30_5',15,60000),
 ('video_wan_30_10',30,120000),
 ('video_luma_ray2_5',27,108000),
 ('video_luma_ray2_9',49,194400)
on conflict(id) do update set cost=excluded.cost,max_millicents=excluded.max_millicents;

alter table public.loox_operations add column if not exists minimum_plan text not null default 'basic'
 check(minimum_plan in ('basic','creator','pro'));
-- Billing ceiling: at most $0.04 of reserved compute per purchased credit.
-- Min annual revenue per credit is $290/3000=$0.09667, before fees and tax.
update public.loox_operations set cost=greatest(cost,ceil(max_millicents/4000.0)::integer);
update public.loox_operations set minimum_plan='creator' where id like 'video_%';
update public.loox_operations set minimum_plan='pro' where id like 'video_kling_40_%' and id not like 'video_kling_40_flash_%'
 or id like 'video_seedance_25_%' or id like 'video_veo_31_%' and id not like 'video_veo_31_lite_%' and id not like 'video_veo_31_fast_%'
 or id like 'video_flux3_video_%' or id like 'video_kling_30_%' or id like 'video_seedance_20_%' and id not like 'video_seedance_20_fast_%' or id like 'video_veo_31_fast_%' or id like 'video_runway_45_%';

create or replace function public.loox_member_tier(p_user uuid) returns text language sql stable set search_path='' as $$
 select case when exists(select 1 from public.loox_subscriptions where user_id=p_user and plan in ('pro','pro_yearly')
 and ((status in ('active','on_trial') and (ends_at is null or ends_at>now())) or (status='cancelled' and ends_at>now())))
 or exists(select 1 from public.loox_payments where user_id=p_user and plan='lifetime' and status='paid') then 'pro'
 when exists(select 1 from public.loox_subscriptions where user_id=p_user and plan in ('creator','creator_yearly')
 and ((status in ('active','on_trial') and (ends_at is null or ends_at>now())) or (status='cancelled' and ends_at>now()))) then 'creator' else 'basic' end
$$;
-- Inject the entitlement check into the existing reserve transaction, preserving
-- idempotency, row locking, refund behavior and the deployed quota logic.
do $$declare definition text;
begin
 select pg_get_functiondef('public.loox_reserve(uuid,uuid,text,text,integer,bigint)'::regprocedure) into definition;
 if position('loox_member_tier' in definition)=0 then
  definition:=replace(definition,'if w.balance<op.cost',
   'p_daily:=case public.loox_member_tier(p_user) when ''pro'' then 250 when ''creator'' then 100 else 25 end; if (op.minimum_plan=''pro'' and public.loox_member_tier(p_user)<>''pro'') or (op.minimum_plan=''creator'' and public.loox_member_tier(p_user)=''basic'') then raise exception ''plan_required''; end if; if w.balance<op.cost');
  definition:=replace(definition,'''generate_video'' then operation=''generate_video''','''generate_video'' or p_operation like ''video_%'' then operation=''generate_video'' or operation like ''video_%''');
  execute definition;
 end if;
end $$;

-- Keyed email identity survives account deletion; local clocks are never trusted.
create table if not exists public.loox_return_rewards(
 fingerprint text primary key, next_claim_at timestamptz not null default now()+interval '12 hours',
 claims integer not null default 0 check(claims>=0)
);
alter table public.loox_return_rewards enable row level security;
revoke all on public.loox_return_rewards from public,anon,authenticated;
grant all on public.loox_return_rewards to service_role;
create or replace function public.loox_reward(p_user uuid,p_fingerprint text,p_claim boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare reward public.loox_return_rewards; w public.loox_wallets; t timestamptz:=clock_timestamp(); eligible boolean;
begin
 if length(p_fingerprint)<>64 then raise exception 'account_unavailable'; end if;
 perform 1 from public.loox_profiles where user_id=p_user and not deleting for share;
 if not found then raise exception 'account_unavailable'; end if;
 -- Same lock order as purchases/reservations; simultaneous tabs cannot double claim.
 select * into strict w from public.loox_wallets where user_id=p_user for update;
 insert into public.loox_return_rewards(fingerprint) values(p_fingerprint) on conflict do nothing;
 select * into strict reward from public.loox_return_rewards where fingerprint=p_fingerprint for update;
 eligible:=public.loox_member_tier(p_user)='basic' and w.debt=0;
 if p_claim then
  if not eligible then raise exception 'plan_required'; end if;
  if reward.next_claim_at>t then raise exception 'reward_not_ready'; end if;
  if w.balance>=10 then raise exception 'reward_balance_cap'; end if;
  update public.loox_return_rewards set next_claim_at=t+interval '12 hours',claims=claims+1 where fingerprint=p_fingerprint returning * into reward;
  update public.loox_wallets set balance=balance+1 where user_id=p_user;
  insert into public.loox_credits(user_id,reason,amount,reference) values(p_user,'Return reward',1,'return/'||p_fingerprint||'/'||reward.claims);
 end if;
 return jsonb_build_object('eligible',eligible,'credits',1,'balance_cap',10,'claimed',p_claim,'server_now',t,'next_claim_at',reward.next_claim_at,'ready',eligible and reward.next_claim_at<=t and (w.balance<10 or p_claim));
end $$;
revoke all on function public.loox_reward(uuid,text,boolean),public.loox_member_tier(uuid) from public,anon,authenticated;
grant execute on function public.loox_reward(uuid,text,boolean),public.loox_member_tier(uuid) to service_role;
do $$declare definition text;
begin
 if to_regprocedure('public.loox_local_claim(text[])') is not null then
  select pg_get_functiondef('public.loox_local_claim(text[])'::regprocedure) into definition;
  if position('loox_member_tier' in definition)=0 then
   definition:=replace(definition,'order by q.created_at','order by q.created_at - case public.loox_member_tier(q.user_id) when ''pro'' then interval ''2 minutes'' when ''creator'' then interval ''1 minute'' else interval ''0 minutes'' end');
   execute definition;
  end if;
 end if;
end $$;
commit;
