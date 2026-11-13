-- LOOX pricing launch: 2026-11-13
-- Credits are granted by loox_account/loox_billing from loox_plans, spent using loox_reserve/loox_operations.
-- Annual allowances are 12x monthly credits. No existing wallet balances are reissued or reset.
-- Video charges target >=40% API-only gross margin on discounted annual Business
-- (USD 690 / 48000 = USD 0.014375 per credit), with 20% provider-cost buffer.
-- This is not a guarantee: recheck invoices, failed predictions, electricity, storage, taxes and provider pricing.
-- Kling 3.0 provisional estimate is deliberately conservative pending a measured paid invoice.
begin;
update public.loox_plans p
set credits = next.credits
from (values ('free',25), ('creator',500), ('creator_yearly',6000), ('pro',1500), ('pro_yearly',18000), ('business',4000), ('business_yearly',48000)) as next(id,credits)
where p.id = next.id and p.credits is distinct from next.credits;

-- Per-model duration prices; legacy Wan operation IDs are also updated for consistency.
with prices(id,credits,budget_millicents) as (
  values
    ('video_wan22_i2v_fast_5',25,17400),
    ('video_wan22_5b_fast_5',5,3000),
    ('video_wan22_t2v_fast_5',15,12000),
    ('video_wan25_i2v_5',75,60000),
    ('video_wan25_i2v_10',140,120000),
    ('video_wan26_i2v_flash_5',35,30000),
    ('video_wan26_i2v_flash_10',70,60000),
    ('video_kling_30_5',350,300000),
    ('video_kling_30_10',700,600000),
    ('video_seedance_20_5',130,108000),
    ('video_seedance_20_10',260,216000),
    ('video_veo_31_fast_4',60,48000),
    ('video_veo_31_fast_6',85,72000),
    ('video_veo_31_fast_8',115,96000),
    ('video_runway_45_5',85,72000),
    ('video_runway_45_10',170,144000),
    ('video_kling_40_5',110,94200),
    ('video_kling_40_10',220,188400),
    ('video_kling_40_flash_5',70,56400),
    ('video_kling_40_flash_10',135,112800),
    ('video_seedance_25_5',165,138720),
    ('video_seedance_25_10',325,277440),
    ('video_seedance_20_fast_5',110,90000),
    ('video_seedance_20_fast_10',210,180000),
    ('video_grok_video_5',50,42000),
    ('video_grok_video_10',100,84000),
    ('video_veo_31_4',225,192000),
    ('video_veo_31_6',335,288000),
    ('video_veo_31_8',450,384000),
    ('video_veo_31_lite_4',30,24000),
    ('video_veo_31_lite_6',45,36000),
    ('video_veo_31_lite_8',60,48000),
    ('video_minimax_h3_5',60,48000),
    ('video_minimax_h3_10',115,96000),
    ('video_minimax_h3_lite_5',30,24000),
    ('video_minimax_h3_lite_10',60,48000),
    ('video_wan_30_5',50,42000),
    ('video_wan_30_10',100,84000),
    ('video_luma_ray2_5',130,108000),
    ('video_luma_ray2_9',230,194400),
    ('video_wan25_i2v',75,60000),
    ('video_wan26_i2v_flash',35,30000)
)
update public.loox_operations o
set cost=p.credits,
    max_millicents=greatest(o.max_millicents,p.budget_millicents)
from prices p
where o.id=p.id and (o.cost is distinct from p.credits or o.max_millicents < p.budget_millicents);
commit;
