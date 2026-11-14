begin;
-- Additive management data. Existing accounts, assets and financial records are preserved.
create table public.loox_admin_roles (
 user_id uuid primary key references auth.users(id), role text not null check(role in ('owner','administrator','support','moderator','finance')),
 permissions text[] not null default '{}', active boolean not null default true, created_at timestamptz not null default now()
);
insert into public.loox_admin_roles(user_id,role)
 select id,'owner' from auth.users where raw_app_meta_data->>'loox_template_admin'='true';
create table public.loox_admin_audit (
 id bigint generated always as identity primary key, actor uuid not null, action text not null,
 target text, reason text not null, detail jsonb not null default '{}', request_id uuid unique,
 created_at timestamptz not null default now()
);
create table public.loox_account_restrictions (
 user_id uuid primary key references auth.users(id), suspended boolean not null default false,
 reason text not null, updated_by uuid not null, updated_at timestamptz not null default now()
);
create table public.loox_support_tickets (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 subject text not null check(length(subject) between 3 and 160), category text not null,
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 status text not null default 'open' check(status in ('open','in_progress','waiting_customer','resolved','closed')),
 reference text, assigned_to uuid references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.loox_support_messages (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.loox_support_tickets(id),
 author uuid not null references auth.users(id), body text not null check(length(body) between 1 and 6000),
 internal boolean not null default false, created_at timestamptz not null default now()
);
alter table public.loox_template_categories add column sort_order integer not null default 0;
alter table public.loox_template_styles add column sort_order integer not null default 0;
create table public.loox_admin_reads (
 user_id uuid not null references auth.users(id), alert_id uuid not null references public.loox_security_alerts(id),
 read_at timestamptz not null default now(), primary key(user_id,alert_id)
);
create index on public.loox_support_tickets(user_id,created_at desc);
create index on public.loox_support_tickets(status,updated_at desc);
create index on public.loox_support_messages(ticket_id,created_at);
create index on public.loox_admin_audit(created_at desc);
create index on public.loox_jobs(user_id,created_at desc);
create function loox_private.audit_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Administrative audit records are immutable';end$$;
create trigger immutable_admin_audit before update or delete on public.loox_admin_audit for each row execute function loox_private.audit_immutable();
-- No direct browser grants. All management reads and writes go through authenticated backend APIs.
alter table public.loox_admin_roles enable row level security;
alter table public.loox_admin_audit enable row level security;
alter table public.loox_account_restrictions enable row level security;
alter table public.loox_support_tickets enable row level security;
alter table public.loox_support_messages enable row level security;
alter table public.loox_admin_reads enable row level security;
revoke all on public.loox_admin_roles,public.loox_admin_audit,public.loox_account_restrictions,public.loox_support_tickets,public.loox_support_messages,public.loox_admin_reads from anon,authenticated;
grant select on public.loox_admin_roles to service_role;
grant select,insert on public.loox_admin_audit to service_role;
grant select,insert,update on public.loox_account_restrictions,public.loox_support_tickets,public.loox_support_messages,public.loox_admin_reads to service_role;
grant usage,select on sequence public.loox_admin_audit_id_seq to service_role;
create function public.loox_control_permission(p_actor uuid,p_permission text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.loox_admin_roles where user_id=p_actor and active and (role='owner' or p_permission=any(permissions) or
 role='support' and p_permission in ('support','accounts_read') or role='moderator' and p_permission='moderation' or role='finance' and p_permission='finance'))
$$;
create function loox_private.control_session(p_user uuid,p_session uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions where id=p_session and user_id=p_user and (not_after is null or not_after>now()))
$$;
revoke all on function loox_private.control_session(uuid,uuid) from public,anon,authenticated;
grant execute on function loox_private.control_session(uuid,uuid) to service_role;
create function public.loox_control_session(p_user uuid,p_session uuid) returns boolean language sql stable security invoker set search_path='' as $$select loox_private.control_session(p_user,p_session)$$;

create function loox_private.control_users(p_search text default '',p_page integer default 1,p_plan text default '',p_status text default '') returns jsonb language sql stable security definer set search_path='' as $$
 with matched as (
 select u.id,u.email,u.created_at,u.last_sign_in_at,u.email_confirmed_at is not null as email_confirmed,
 p.name,coalesce(w.balance,0) as balance,coalesce(r.suspended,false) as suspended,
 (select jsonb_agg(jsonb_build_object('plan',s.plan,'status',s.status,'ends_at',s.ends_at)) from public.loox_subscriptions s where s.user_id=u.id) as subscriptions,
 (select count(*) from public.loox_jobs j where j.user_id=u.id) as generations
 from auth.users u left join public.loox_profiles p on p.user_id=u.id
 left join public.loox_wallets w on w.user_id=u.id left join public.loox_account_restrictions r on r.user_id=u.id
 where (p_search='' or position(lower(p_search) in lower(coalesce(u.email,'')||' '||u.id::text||' '||coalesce(p.name,'')))>0)
 and (p_plan='' or exists(select 1 from public.loox_subscriptions s where s.user_id=u.id and s.plan=p_plan))
 and (p_status='' or coalesce(r.suspended,false)=(p_status='suspended'))
 ), page as (select * from matched order by created_at desc,id limit 25 offset (greatest(1,least(p_page,10000))-1)*25)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select count(*) from matched),'page',p_page)
$$;
revoke all on function loox_private.control_users(text,integer,text,text) from public,anon,authenticated;
grant execute on function loox_private.control_users(text,integer,text,text) to service_role;
create function public.loox_control_users(p_search text default '',p_page integer default 1,p_plan text default '',p_status text default '') returns jsonb language sql stable security invoker set search_path='' as $$select loox_private.control_users(p_search,p_page,p_plan,p_status)$$;

create function loox_private.control_overview(p_start timestamptz,p_end timestamptz) returns jsonb language sql stable security definer set search_path='' as $$
 with daily as (
 select d::date as day from generate_series(date_trunc('day',p_start),date_trunc('day',p_end-interval '1 microsecond'),interval '1 day') d
 ), sales as (
 select amount_cents,created_at from public.loox_payments where status='paid' and currency='USD'
 union all select amount_cents,created_at from public.loox_recharge_payments where status='paid' and currency='USD'
 ), series as (
 select day,
 (select count(*) from auth.users where created_at>=day and created_at<day+1) users,
 (select count(*) from public.loox_jobs where created_at>=day and created_at<day+1) jobs,
 (select count(*) from public.loox_jobs where state='failed' and created_at>=day and created_at<day+1) failures,
 (select coalesce(sum(amount_cents),0) from sales where created_at>=day and created_at<day+1) paid_cents,
 (select coalesce(sum(-amount),0) from public.loox_credits where amount<0 and created_at>=day and created_at<day+1) credits,
 (select coalesce(sum(estimated_millicents),0) from public.loox_provider_costs where created_at>=day and created_at<day+1) estimated_cost_millicents,
 (select sum(actual_millicents) from public.loox_provider_costs where created_at>=day and created_at<day+1) reported_cost_millicents from daily
 ) select jsonb_build_object(
 'registered_users',(select count(*) from auth.users),
 'new_today',(select count(*) from auth.users where created_at>=date_trunc('day',now())),
 'new_7d',(select count(*) from auth.users where created_at>=now()-interval '7 days'),
 'active_30d',(select count(*) from auth.users where last_sign_in_at>=now()-interval '30 days'),
 'active_subscriptions',(select count(*) from public.loox_subscriptions where status in ('active','on_trial') and (ends_at is null or ends_at>now())),
 'mrr_cents',(select coalesce(sum(p.price_cents),0) from public.loox_subscriptions s join public.loox_plans p on p.id=s.plan where s.status='active' and p.cadence='month' and (s.ends_at is null or s.ends_at>now())),
 'paid_records_cents',(select coalesce(sum(amount_cents),0) from sales where created_at>=p_start and created_at<p_end),
 'open_tickets',(select count(*) from public.loox_support_tickets where status not in ('resolved','closed')),
 'generation_jobs',(select count(*) from public.loox_jobs where created_at>=p_start and created_at<p_end),
 'failed_jobs',(select count(*) from public.loox_jobs where state='failed' and created_at>=p_start and created_at<p_end),
 'outstanding_credits',(select coalesce(sum(balance),0) from public.loox_wallets),
 'estimated_cost_millicents',(select sum(estimated_millicents) from public.loox_provider_costs where created_at>=p_start and created_at<p_end),
 'reported_cost_millicents',(select sum(actual_millicents) from public.loox_provider_costs where created_at>=p_start and created_at<p_end),
 'series',coalesce((select jsonb_agg(to_jsonb(series) order by day) from series),'[]'::jsonb),
 'note','Payment records confirmed by existing billing processing; MRR is an internal estimate. Provider spending may be incomplete. Fees, payouts, taxes, electricity and other operating expenses are not verified. Cash profit is unavailable.'
 )
$$;
revoke all on function loox_private.control_overview(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function loox_private.control_overview(timestamptz,timestamptz) to service_role;
create function public.loox_control_overview(p_start timestamptz,p_end timestamptz) returns jsonb language sql stable security invoker set search_path='' as $$select loox_private.control_overview(p_start,p_end)$$;

create function public.loox_control_mutate(p_actor uuid,p_action text,p_target text,p_reason text,p_request uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare permission text; previous public.loox_admin_audit; result jsonb; target_ticket public.loox_support_tickets;
begin
 if length(trim(p_reason)) not between 5 and 500 or p_request is null then raise exception 'A written reason and request ID are required';end if;
 permission:=case when p_action='restriction' then 'accounts_write' when p_action in ('model_price','model_pause') then 'models' when p_action in ('template_save','taxonomy') then 'templates' when p_action='ticket_update' or p_action='ticket_reply' then 'support' else null end;
 if permission is null or not public.loox_control_permission(p_actor,permission) then raise exception 'Permission denied';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into previous from public.loox_admin_audit where request_id=p_request;
 if found then
 if previous.actor<>p_actor or previous.action<>p_action or previous.target<>p_target or previous.detail<>p_data or previous.reason<>trim(p_reason) then raise exception 'Idempotency conflict';end if;
 return jsonb_build_object('saved',true,'duplicate',true);end if;
 if p_action='restriction' then
 if exists(select 1 from public.loox_admin_roles where user_id=p_target::uuid and active) then raise exception 'Cannot restrict an administrator';end if;
 if jsonb_typeof(p_data->'suspended') is distinct from 'boolean' then raise exception 'Invalid restriction';end if;
 insert into public.loox_account_restrictions(user_id,suspended,reason,updated_by) values(p_target::uuid,(p_data->>'suspended')::boolean,trim(p_reason),p_actor)
 on conflict(user_id) do update set suspended=excluded.suspended,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=now();
 elsif p_action='model_pause' then
 if not exists(select 1 from public.loox_operations where id=p_target) or jsonb_typeof(p_data->'paused') is distinct from 'boolean' then raise exception 'Invalid model pause';end if;
 update public.loox_cost_controls set disabled_operations=case when (p_data->>'paused')::boolean then array(select distinct unnest(disabled_operations||array[p_target])) else array_remove(disabled_operations,p_target) end where id=true;
 elsif p_action='model_price' then
 if (p_data->>'credits')::integer not between 1 and 10000 then raise exception 'Invalid credit price';end if;
 update public.loox_operations set cost=(p_data->>'credits')::integer where id=p_target;
 if not found then raise exception 'Model operation not found';end if;
 elsif p_action='template_save' then
 if length(p_data->>'title') not between 1 and 120 or length(p_data->>'prompt') not between 1 and 1200 or p_data->>'kind' not in ('image','video') or not exists(select 1 from public.loox_template_categories where name=p_data->>'category') then raise exception 'Invalid template';end if;
 if exists(select 1 from jsonb_array_elements_text(p_data->'styles') s where not exists(select 1 from public.loox_template_styles where name=s)) then raise exception 'Unknown template style';end if;
 insert into public.loox_template_catalog(id,title,description,prompt,kind,category,model_id,settings,author,license,active,media_path,media_provider,media_key,thumbnail_key,media_type,style,styles)
 values(p_target,p_data->>'title',p_data->>'description',p_data->>'prompt',p_data->>'kind',p_data->>'category',nullif(p_data->>'model_id',''),coalesce(p_data->'settings','{}'), 'LOOX AI','LOOX original',(p_data->>'active')::boolean,p_data->>'media_path',p_data->>'media_provider',p_data->>'media_key',p_data->>'thumbnail_key',p_data->>'kind',p_data->'styles'->>0,array(select jsonb_array_elements_text(p_data->'styles')))
 on conflict(id) do update set title=excluded.title,description=excluded.description,prompt=excluded.prompt,kind=excluded.kind,category=excluded.category,model_id=excluded.model_id,settings=excluded.settings,active=excluded.active,media_path=excluded.media_path,media_provider=excluded.media_provider,media_key=excluded.media_key,thumbnail_key=excluded.thumbnail_key,media_type=excluded.media_type,style=excluded.style,styles=excluded.styles,updated_at=now();
 elsif p_action='taxonomy' then
 if length(trim(p_data->>'name')) not between 1 and 70 or p_data->>'kind' not in ('category','style') then raise exception 'Invalid category or style';end if;
 if p_data->>'kind'='category' then
 insert into public.loox_template_categories(name,sort_order) values(trim(p_data->>'name'),coalesce((p_data->>'sort_order')::integer,0)) on conflict(name) do update set sort_order=excluded.sort_order;
 if p_target<>'' and p_target<>p_data->>'name' then
 update public.loox_template_catalog set category=trim(p_data->>'name') where category=p_target;
 delete from public.loox_template_categories where name=p_target;end if;
 else
 insert into public.loox_template_styles(name,sort_order) values(trim(p_data->>'name'),coalesce((p_data->>'sort_order')::integer,0)) on conflict(name) do update set sort_order=excluded.sort_order;
 if p_target<>'' and p_target<>p_data->>'name' then
 update public.loox_template_catalog set styles=array_replace(styles,p_target,trim(p_data->>'name')),style=case when style=p_target then trim(p_data->>'name') else style end where p_target=any(styles) or style=p_target;
 delete from public.loox_template_styles where name=p_target;end if;
 end if;
 elsif p_action='ticket_update' then
 select * into strict target_ticket from public.loox_support_tickets where id=p_target::uuid for update;
 if p_data->>'status' not in ('open','in_progress','waiting_customer','resolved','closed') or p_data->>'priority' not in ('low','normal','high','urgent') then raise exception 'Invalid ticket update';end if;
 if nullif(p_data->>'assigned_to','') is not null and not public.loox_control_permission((p_data->>'assigned_to')::uuid,'support') then raise exception 'Assignee is not a support administrator';end if;
 update public.loox_support_tickets set status=p_data->>'status',priority=p_data->>'priority',assigned_to=nullif(p_data->>'assigned_to','')::uuid,updated_at=now() where id=target_ticket.id;
 elsif p_action='ticket_reply' then
 if length(trim(p_data->>'body')) not between 1 and 6000 or jsonb_typeof(p_data->'internal') is distinct from 'boolean' then raise exception 'Invalid reply';end if;
 select * into strict target_ticket from public.loox_support_tickets where id=p_target::uuid for update;
 insert into public.loox_support_messages(ticket_id,author,body,internal) values(target_ticket.id,p_actor,trim(p_data->>'body'),(p_data->>'internal')::boolean);
 update public.loox_support_tickets set updated_at=now() where id=target_ticket.id;
 end if;
 insert into public.loox_admin_audit(actor,action,target,reason,request_id,detail) values(p_actor,p_action,p_target,trim(p_reason),p_request,p_data);
 return jsonb_build_object('saved',true,'notification','Stored in customer support inbox. External email delivery is not configured for tickets.');
end$$;
create function public.loox_support_create(p_user uuid,p_subject text,p_category text,p_body text,p_reference text,p_request uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.loox_support_tickets;
begin
 if length(trim(p_body)) not between 1 and 6000 or length(trim(p_subject)) not between 3 and 160 or length(coalesce(p_reference,''))>200 or p_category not in ('payment','missing_credits','subscription','generation','refund','account','bug','community','general') then raise exception 'Invalid support request';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into t from public.loox_support_tickets where id=p_request;
 if found then if t.user_id<>p_user then raise exception 'Request ID already used';end if;return jsonb_build_object('id',t.id,'duplicate',true);end if;
 insert into public.loox_support_tickets(id,user_id,subject,category,reference) values(p_request,p_user,trim(p_subject),p_category,p_reference) returning * into t;
 insert into public.loox_support_messages(ticket_id,author,body) values(t.id,p_user,trim(p_body));
 return jsonb_build_object('id',t.id);
end$$;
revoke all on function loox_private.audit_immutable(),public.loox_control_permission(uuid,text),public.loox_control_session(uuid,uuid),public.loox_control_users(text,integer,text,text),public.loox_control_overview(timestamptz,timestamptz),public.loox_control_mutate(uuid,text,text,text,uuid,jsonb),public.loox_support_create(uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.loox_control_permission(uuid,text),public.loox_control_session(uuid,uuid),public.loox_control_users(text,integer,text,text),public.loox_control_overview(timestamptz,timestamptz),public.loox_control_mutate(uuid,text,text,text,uuid,jsonb),public.loox_support_create(uuid,text,text,text,text,uuid) to service_role;
commit;
