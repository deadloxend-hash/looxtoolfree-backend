-- Backend-only administrative operations. Browser roles cannot execute these RPCs.
create function loox_private.admin_overview() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'accounts',(select count(*) from auth.users),
 'registrations_7d',(select count(*) from auth.users where created_at>now()-interval '7 days'),
 'creators',(select count(*) from public.loox_creator_profiles),
 'posts',(select count(*) from public.loox_community_posts),
 'published',(select count(*) from public.loox_community_posts where status='approved' and visible),
 'pending',(select count(*) from public.loox_template_submissions where status='pending'),
 'open_reports',(select count(*) from public.loox_content_reports where status='open'),
 'jobs',(select count(*) from public.loox_jobs),
 'failed_jobs',(select count(*) from public.loox_jobs where state='failed'),
 'credits_reserved',(select coalesce(-sum(amount),0) from public.loox_credits where reason='Reserved'),
 'credits_released',(select coalesce(sum(amount),0) from public.loox_credits where reason='Released'),
 'storage_bytes',(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects),
 'spend_budget_millicents',(select coalesce(sum(millicents),0) from public.loox_spend),
 'spend_note','Processing budget estimates, not provider invoices. Storage totals cover Supabase only.');
$$;
create function loox_private.admin_resolve_report(p_admin uuid,p_id uuid,p_status text,p_remove boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.loox_content_reports;
begin
 if not exists(select 1 from auth.users where id=p_admin and raw_app_meta_data->>'loox_template_admin'='true') then raise exception 'Administrator access required';end if;
 if p_status not in ('resolved','dismissed') then raise exception 'Invalid report action';end if;
 select * into r from public.loox_content_reports where id=p_id and status='open' for update;
 if not found then raise exception 'Report is no longer open';end if;
 if p_remove then
  if r.comment_id is not null then delete from public.loox_post_comments where id=r.comment_id and post_id=r.post_id;
  else update public.loox_template_submissions set visible=false where id=r.post_id;end if;
 end if;
 update public.loox_content_reports set status=p_status where id=r.id;
 insert into public.loox_moderation_log(admin_id,post_id,action,reason) values(p_admin,r.post_id,case when p_remove then 'removed_reported_content' else p_status end,r.reason);
 return jsonb_build_object('saved',true);
end $$;
create function loox_private.admin_adjust_credits(p_admin uuid,p_user uuid,p_amount integer,p_reason text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.loox_wallets;prev public.loox_credits;
begin
 if not exists(select 1 from auth.users where id=p_admin and raw_app_meta_data->>'loox_template_admin'='true') then raise exception 'Administrator access required';end if;
 if p_amount=0 or abs(p_amount::bigint)>10000 or length(trim(p_reason)) not between 5 and 300 or p_request is null then raise exception 'Invalid credit adjustment';end if;
 select * into w from public.loox_wallets where user_id=p_user for update;
 if not found then raise exception 'Wallet not found';end if;
 select * into prev from public.loox_credits where user_id=p_user and reason='Admin adjustment' and reference=p_request::text;
 if found then
  if prev.amount<>p_amount then raise exception 'Adjustment request already used';end if;
  return jsonb_build_object('balance',w.balance,'duplicate',true);
 end if;
 if w.debt>0 or w.balance+p_amount<0 then raise exception 'Adjustment would create an invalid balance';end if;
 update public.loox_wallets set balance=balance+p_amount where user_id=p_user returning * into w;
 insert into public.loox_credits(user_id,reason,amount,reference) values(p_user,'Admin adjustment',p_amount,p_request::text);
 insert into public.loox_moderation_log(admin_id,action,reason) values(p_admin,'credit_adjustment',p_user::text||' / '||p_amount::text||' / '||p_request::text||' / '||trim(p_reason));
 return jsonb_build_object('balance',w.balance,'duplicate',false);
end $$;
revoke all on function loox_private.admin_overview(),loox_private.admin_resolve_report(uuid,uuid,text,boolean),loox_private.admin_adjust_credits(uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant usage on schema loox_private to service_role;
grant execute on function loox_private.admin_overview(),loox_private.admin_resolve_report(uuid,uuid,text,boolean),loox_private.admin_adjust_credits(uuid,uuid,integer,text,uuid) to service_role;
create function public.loox_admin_overview() returns jsonb language sql stable security invoker set search_path='' as $$select loox_private.admin_overview()$$;
create function public.loox_admin_resolve_report(p_admin uuid,p_id uuid,p_status text,p_remove boolean) returns jsonb language sql security invoker set search_path='' as $$select loox_private.admin_resolve_report(p_admin,p_id,p_status,p_remove)$$;
create function public.loox_admin_adjust_credits(p_admin uuid,p_user uuid,p_amount integer,p_reason text,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$select loox_private.admin_adjust_credits(p_admin,p_user,p_amount,p_reason,p_request)$$;
revoke all on function public.loox_admin_overview(),public.loox_admin_resolve_report(uuid,uuid,text,boolean),public.loox_admin_adjust_credits(uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.loox_admin_overview(),public.loox_admin_resolve_report(uuid,uuid,text,boolean),public.loox_admin_adjust_credits(uuid,uuid,integer,text,uuid) to service_role;
