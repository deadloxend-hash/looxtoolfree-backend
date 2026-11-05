-- Draft per-image LOOX prices. Recheck provider cost and actual paid-plan economics before activation.
insert into public.loox_operations (id,cost,max_millicents) values
 ('generate_google_nano_2',8,100000),
 ('generate_google_nano_pro',18,100000),
 ('generate_bfl_flux2_pro',9,100000),
 ('generate_bfl_klein_4b',5,100000),
 ('generate_ideogram_p_image',7,100000),
 ('generate_ideogram_45',13,100000),
 ('generate_stability_sd35',10,100000),
 ('generate_stability_ultra',12,100000),
 ('generate_byteplus_45',8,100000),
 ('generate_byteplus_50_flash',9,100000),
 ('generate_openai_gpt_image',16,100000),
 ('generate_replicate_qwen2',7,100000),
 ('generate_replicate_hidream',5,100000),
 ('generate_replicate_imagen4',6,100000),
 ('generate_replicate_photon',7,100000),
 ('generate_replicate_flux_ultra',9,100000)
on conflict (id) do update set cost=excluded.cost,max_millicents=excluded.max_millicents;
