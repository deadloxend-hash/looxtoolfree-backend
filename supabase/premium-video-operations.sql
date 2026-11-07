-- Premium LOOX Video credit costs and spend ceilings by supported duration.
insert into public.loox_operations (id,cost,max_millicents) values
('video_kling_30_5',70,250000),
('video_kling_30_10',140,350000),
('video_seedance_20_5',80,300000),
('video_seedance_20_10',160,550000),
('video_veo_31_fast_4',75,230000),
('video_veo_31_fast_6',110,330000),
('video_veo_31_fast_8',150,440000),
('video_runway_45_5',75,150000),
('video_runway_45_10',150,250000),
('video_flux3_video_5',35,85000),
('video_flux3_video_10',70,145000)
on conflict(id) do update set cost=excluded.cost,max_millicents=excluded.max_millicents;
