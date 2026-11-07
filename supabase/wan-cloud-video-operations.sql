-- Applied to Supabase project LOOX Tools on 2026-11-07.
-- Cloud video job operations are separate from the existing local generate_video op.
-- max_millicents is a conservative per-job budget reservation ceiling.
insert into public.loox_operations (id,cost,max_millicents)
values
 ('video_wan22_i2v_fast',5,20000),
 ('video_wan22_5b_fast',3,12000),
 ('video_wan22_t2v_fast',5,20000),
 ('video_wan25_i2v',35,140000),
 ('video_wan26_i2v_flash',20,85000)
on conflict (id) do update
set cost=excluded.cost, max_millicents=excluded.max_millicents;
