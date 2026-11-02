-- LOOX AI processing operations added 2026-11-02.
-- Apply with owner credentials only. No browser permissions are granted by this SQL.
-- max_millicents is the reserved daily budget amount (thousandths of a cent).
insert into public.loox_operations (id,cost,max_millicents)
values
 ('enhance',2,4000),
 ('uncrop',4,8000),
 ('restore',3,8000),
 ('retouch',3,8000),
 ('face_restore',3,50000),
 ('face_swap',4,30000)
on conflict (id) do update set
 cost=excluded.cost,
 max_millicents=excluded.max_millicents;
