create table public.loox_user_styles (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 60),
 prompt text not null check (length(trim(prompt)) between 1 and 500),
 favorite boolean not null default false,
 preview_job_id uuid references public.loox_jobs(id) on delete set null,
 created_at timestamptz not null default now()
);
alter table public.loox_user_styles enable row level security;
revoke all on public.loox_user_styles from anon, authenticated;
grant select,insert,update,delete on public.loox_user_styles to authenticated;
create policy own_styles_select on public.loox_user_styles for select to authenticated using (user_id=(select auth.uid()));
create policy own_styles_insert on public.loox_user_styles for insert to authenticated with check (user_id=(select auth.uid()) and (preview_job_id is null or exists(select 1 from public.loox_jobs j where j.id=preview_job_id and j.user_id=(select auth.uid()))));
create policy own_styles_update on public.loox_user_styles for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()) and (preview_job_id is null or exists(select 1 from public.loox_jobs j where j.id=preview_job_id and j.user_id=(select auth.uid()))));
create policy own_styles_delete on public.loox_user_styles for delete to authenticated using (user_id=(select auth.uid()));
create index loox_user_styles_owner on public.loox_user_styles(user_id,created_at desc);
