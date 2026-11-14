begin;
create function public.loox_billing_health() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'wallet_mismatches',(select count(*) from public.loox_wallets w where w.balance-w.debt<>(select coalesce(sum(c.amount),0) from public.loox_credits c where c.user_id=w.user_id)),
 'payment_mismatches',(select count(*) from public.loox_payments p where p.status='paid' and not exists(select 1 from public.loox_credits c where c.user_id=p.user_id and c.reference=p.reference and c.reason='Purchase' and c.amount=p.credits)),
 'pending_events',(select count(*) from public.loox_payment_events where status='failed' or (status='pending' and updated_at<now()-interval '5 minutes')),
 'failed_jobs_24h',(select count(*) from public.loox_jobs where created_at>now()-interval '24 hours' and state='failed'),
 'jobs_24h',(select count(*) from public.loox_jobs where created_at>now()-interval '24 hours'),
 'provider_reconciled',false
 );
$$;
revoke all on function public.loox_billing_health() from public,anon,authenticated;
grant execute on function public.loox_billing_health() to service_role;
commit;
