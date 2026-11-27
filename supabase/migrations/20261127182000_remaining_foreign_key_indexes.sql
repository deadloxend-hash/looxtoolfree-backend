-- Additive indexes only. No data, grants, constraints, prices or balances change.
begin;
set local lock_timeout='1s';
set local statement_timeout='15s';
-- Production preflight found all affected tables below 350 KiB. Fail closed if reused on large tables.
do $$
begin
 if pg_total_relation_size('public.loox_admin_reads'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_content_reports'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_jobs'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_local_queue'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_moderation_log'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_oauth_reauth_receipts'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_payments'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_privacy_proofs'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_provider_operations'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_subscriptions'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_support_messages'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_support_tickets'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_template_submissions'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
 if pg_total_relation_size('public.loox_user_styles'::regclass)>16*1024*1024 then raise exception 'Large table requires a separately planned concurrent index build';end if;
end $$;
create index if not exists loox_admin_reads_alert_id_fk_cover on public.loox_admin_reads(alert_id);
create index if not exists loox_content_reports_comment_id_fk_cover on public.loox_content_reports(comment_id);
create index if not exists loox_content_reports_post_id_fk_cover on public.loox_content_reports(post_id);
create index if not exists loox_jobs_operation_fk_cover on public.loox_jobs(operation);
create index if not exists loox_local_queue_user_id_fk_cover on public.loox_local_queue(user_id);
create index if not exists loox_moderation_log_admin_id_fk_cover on public.loox_moderation_log(admin_id);
create index if not exists loox_oauth_reauth_receipts_user_id_fk_cover on public.loox_oauth_reauth_receipts(user_id);
create index if not exists loox_payments_plan_fk_cover on public.loox_payments(plan);
create index if not exists loox_privacy_proofs_user_id_fk_cover on public.loox_privacy_proofs(user_id);
create index if not exists loox_provider_operations_provider_fk_cover on public.loox_provider_operations(provider);
create index if not exists loox_subscriptions_plan_fk_cover on public.loox_subscriptions(plan);
create index if not exists loox_support_messages_author_fk_cover on public.loox_support_messages(author);
create index if not exists loox_support_tickets_assigned_to_fk_cover on public.loox_support_tickets(assigned_to);
create index if not exists loox_template_submissions_reviewed_by_fk_cover on public.loox_template_submissions(reviewed_by);
create index if not exists loox_template_submissions_user_id_fk_cover on public.loox_template_submissions(user_id);
create index if not exists loox_user_styles_preview_job_id_fk_cover on public.loox_user_styles(preview_job_id);
-- loox_media_entries already has a covering (user_id,session_id,created_at,id) index.
-- Do not add a reversed duplicate merely to silence an order-sensitive advisor notice.
commit;
