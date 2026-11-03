-- Community image templates: only the Vercel service role accesses this table.
-- Users can submit only completed, account-owned FLUX jobs through /api/templates.
-- Admin review requires verified auth.app_metadata.loox_template_admin === true.
create table if not exists public.loox_template_submissions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 job_id uuid not null unique references public.loox_jobs(id) on delete cascade,
 prompt text not null check (length(prompt) between 1 and 1200),
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 submitted_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id) on delete set null
);
create index if not exists loox_template_status_idx
 on public.loox_template_submissions(status,submitted_at desc);
alter table public.loox_template_submissions enable row level security;
revoke all on public.loox_template_submissions from anon, authenticated;
