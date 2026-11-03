-- Account-owned LOOX AI chat history. No guest, public, or cross-account access.
create table if not exists public.loox_chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null check (model in ('free','premium')),
  title text not null default 'New chat' check (length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loox_chat_threads_user_recent on public.loox_chat_threads (user_id,updated_at desc,id);
create table if not exists public.loox_chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.loox_chat_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (length(content) between 1 and 6000),
  created_at timestamptz not null default now()
);
create index if not exists loox_chat_messages_thread_order on public.loox_chat_messages (thread_id,id);
alter table public.loox_chat_threads enable row level security;
alter table public.loox_chat_messages enable row level security;
-- These are server-only tables. The backend checks Supabase Auth and user_id
-- before any operation, then uses the service key on the server.
revoke all on public.loox_chat_threads,public.loox_chat_messages from public,anon,authenticated;
grant select,insert,update,delete on public.loox_chat_threads,public.loox_chat_messages to service_role;
grant usage,select on sequence public.loox_chat_messages_id_seq to service_role;
