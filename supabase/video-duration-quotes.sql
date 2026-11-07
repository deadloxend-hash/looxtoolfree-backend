-- Preserve existing 5-second credit rates; apply proportional duration pricing.
-- Provider references checked 2026-11-07:
-- https://replicate.com/wan-video/wan-2.5-i2v (720p $0.10/output second)
-- https://replicate.com/wan-video/wan2.6-i2v-flash (720p $0.05/output second listed)
-- Preserve conservative budget ceilings, not actual provider invoices.
-- Keep legacy operation rows for existing jobs and reconciliation.
insert into public.loox_operations(id,cost,max_millicents)
select base.id||'_'||d.seconds,base.cost*d.seconds/5,base.max_millicents*d.seconds/10
from public.loox_operations base cross join (values(5),(10)) as d(seconds)
where base.id in ('video_wan25_i2v','video_wan26_i2v_flash') on conflict(id) do nothing;
