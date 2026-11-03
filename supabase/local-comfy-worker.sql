
-- LOOX local ComfyUI job transport. Private: only the Vercel service-role backend can access.
create table if not exists public.loox_local_queue (
  job_id uuid primary key references public.loox_jobs(id) on delete cascade,
  user_id uuid not null references public.loox_profiles(user_id) on delete cascade,
  operation text not null check (operation in ('generate','generate_video')),
  input jsonb not null,
  lease uuid,
  leased_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists loox_local_queue_claim_idx on public.loox_local_queue(created_at);
create table if not exists public.loox_local_worker_health (
  id integer primary key check(id=1),
  modes text[] not null default '{}',
  last_seen timestamptz not null default now()
);
alter table public.loox_local_queue enable row level security;
alter table public.loox_local_worker_health enable row level security;
revoke all on public.loox_local_queue,public.loox_local_worker_health from public,anon,authenticated;
grant all on public.loox_local_queue,public.loox_local_worker_health to service_role;
insert into public.loox_operations(id,cost,max_millicents) values ('generate_video',8,1000) on conflict(id) do nothing;

create or replace function public.loox_local_ping(p_modes text[]) returns void language plpgsql set search_path='' as $$
begin
  insert into public.loox_local_worker_health(id,modes,last_seen)
    values(1,array(select distinct m from unnest(p_modes) m where m in ('generate','generate_video')),now())
    on conflict(id) do update set modes=excluded.modes,last_seen=excluded.last_seen;
end $$;

create or replace function public.loox_local_claim() returns jsonb language plpgsql set search_path='' as $$
declare rec record; token uuid;
begin
  select q.job_id,q.user_id,q.operation,q.input into rec
  from public.loox_local_queue q join public.loox_jobs j on j.id=q.job_id
  where j.state in ('reserved','processing')
    and (q.lease is null or q.leased_at < now()-interval '2 hours')
    and q.created_at > now()-interval '4 hours'
  order by q.created_at for update of q skip locked limit 1;
  if not found then return null; end if;
  token:=gen_random_uuid();
  update public.loox_local_queue set lease=token,leased_at=now() where job_id=rec.job_id;
  update public.loox_jobs set state='processing' where id=rec.job_id and state in ('reserved','processing');
  return jsonb_build_object('id',rec.job_id,'user_id',rec.user_id,'operation',rec.operation,'input',rec.input,'lease',token);
end $$;

create or replace function public.loox_local_complete(p_id uuid,p_lease uuid,p_path text)
returns boolean language plpgsql set search_path='' as $$
declare q public.loox_local_queue;
begin
  select * into q from public.loox_local_queue where job_id=p_id for update;
  if not found or q.lease is distinct from p_lease then return false; end if;
  if (select state from public.loox_jobs where id=p_id) not in ('processing','reserved') then return false; end if;
  if p_path is not null and p_path<>q.user_id::text||'/'||q.job_id::text||
    (case when q.operation='generate_video' then '.mp4' else '.png' end) then
    return false;
  end if;
  perform public.loox_finish(p_id,p_path);
  delete from public.loox_local_queue where job_id=p_id;
  return true;
end $$;

create or replace function public.loox_local_expire() returns integer language plpgsql set search_path='' as $$
declare r record; n integer:=0;
begin
  for r in
    select q.job_id from public.loox_local_queue q
    join public.loox_jobs j on j.id=q.job_id
    where j.state in ('reserved','processing') and
      ((q.lease is null and q.created_at<now()-interval '20 minutes')
       or (q.lease is not null and q.leased_at<now()-interval '2 hours'))
    for update of q skip locked
  loop
    perform public.loox_finish(r.job_id,null);
    delete from public.loox_local_queue where job_id=r.job_id;
    n:=n+1;
  end loop;
  return n;
end $$;

revoke all on function public.loox_local_ping(text[]) from public,anon,authenticated;
revoke all on function public.loox_local_claim() from public,anon,authenticated;
revoke all on function public.loox_local_complete(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.loox_local_expire() from public,anon,authenticated;
grant execute on function public.loox_local_ping(text[]),public.loox_local_claim(),
  public.loox_local_complete(uuid,uuid,text),public.loox_local_expire() to service_role;


-- Workers advertise their installed workflows; never lease incompatible jobs.
create or replace function public.loox_local_claim(p_modes text[]) returns jsonb language plpgsql set search_path='' as $$
declare rec record; token uuid;
begin
  select q.job_id,q.user_id,q.operation,q.input into rec
  from public.loox_local_queue q join public.loox_jobs j on j.id=q.job_id
  where j.state in ('reserved','processing')
    and q.operation=any(p_modes)
    and (q.lease is null or q.leased_at < now()-interval '2 hours')
    and q.created_at > now()-interval '4 hours'
  order by q.created_at for update of q skip locked limit 1;
  if not found then return null; end if;
  token:=gen_random_uuid();
  update public.loox_local_queue set lease=token,leased_at=now() where job_id=rec.job_id;
  update public.loox_jobs set state='processing' where id=rec.job_id and state in ('reserved','processing');
  return jsonb_build_object('id',rec.job_id,'user_id',rec.user_id,'operation',rec.operation,'input',rec.input,'lease',token);
end $$;
revoke all on function public.loox_local_claim(text[]) from public,anon,authenticated;
grant execute on function public.loox_local_claim(text[]) to service_role;
revoke all on function public.loox_local_claim() from public,anon,authenticated;
drop function public.loox_local_claim();

-- Validate output existence and byte limits atomically before credit settlement.
create or replace function public.loox_local_complete(p_id uuid,p_lease uuid,p_path text)
returns boolean language plpgsql set search_path='' as $$
declare q public.loox_local_queue; file_size bigint;
begin
  select * into q from public.loox_local_queue where job_id=p_id for update;
  if not found or q.lease is distinct from p_lease then return false; end if;
  if (select state from public.loox_jobs where id=p_id) not in ('processing','reserved') then return false; end if;
  if p_path is not null then
    if p_path is distinct from (q.user_id::text||'/'||q.job_id::text||
      (case when q.operation='generate_video' then '.mp4' else '.png' end)) then return false; end if;
    select (metadata->>'size')::bigint into file_size
      from storage.objects
      where bucket_id='loox-results' and name=p_path;
    if coalesce(file_size,0) not between 1 and
      (case when q.operation='generate_video' then 40000000 else 16000000 end) then
      return false;
    end if;
  end if;
  perform public.loox_finish(p_id,p_path);
  delete from public.loox_local_queue where job_id=p_id;
  return true;
end $$;
revoke all on function public.loox_local_complete(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.loox_local_complete(uuid,uuid,text) to service_role;
