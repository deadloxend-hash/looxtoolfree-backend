insert into public.loox_operations(id,cost,max_millicents) values ('fill',3,8000) on conflict(id) do nothing;
