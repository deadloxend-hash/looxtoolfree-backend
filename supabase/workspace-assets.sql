create table public.loox_user_assets (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 100),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 object_key text not null,thumbnail_key text not null,media_type text not null check(media_type='image/webp'),
 media_bytes integer not null check(media_bytes between 1 and 2400000),width integer not null check(width>0),height integer not null check(height>0),
 created_at timestamptz not null default now(),deleted_at timestamptz,unique(user_id,sha256)
);
alter table public.loox_user_assets enable row level security;
revoke all on public.loox_user_assets from anon,authenticated;
grant select on public.loox_user_assets to authenticated;
grant all on public.loox_user_assets to service_role;
create policy own_assets on public.loox_user_assets for select to authenticated using(user_id=(select auth.uid()));
create index loox_user_assets_owner on public.loox_user_assets(user_id,created_at desc);
