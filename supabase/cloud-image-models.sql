-- Premium image generation operations. Apply in the dedicated LOOX Tools database.
-- Cost is LOOX credits per completed image; max_millicents reserves daily provider budget.
insert into public.loox_operations (id,cost,max_millicents) values
 ('generate_replicate',6,10000),
 ('generate_google',5,10000),
 ('generate_bfl',6,10000),
 ('generate_ideogram',6,10000),
 ('generate_stability',5,10000),
 ('generate_byteplus',6,10000),
 ('generate_openai',6,10000)
on conflict (id) do update set cost=excluded.cost,max_millicents=excluded.max_millicents;
