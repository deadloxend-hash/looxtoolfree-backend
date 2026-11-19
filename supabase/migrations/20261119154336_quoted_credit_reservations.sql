-- Additive guard: price confirmation and wallet reservation share one transaction.
-- Existing reservations, balances, prices, entitlements and RPCs are preserved.
begin;
create function public.loox_reserve_quoted(p_user uuid,p_request uuid,p_digest text,p_operation text,p_daily integer,p_budget bigint,p_expected_cost integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actual integer;
begin
 if p_expected_cost is null or p_expected_cost<=0 then raise exception 'price_changed'; end if;
 -- Match the existing reserve lock order, then hold the operation price stable.
 perform 1 from public.loox_wallets where user_id=p_user for update;
 if exists(select 1 from public.loox_jobs where user_id=p_user and request_id=p_request) then
  return public.loox_reserve(p_user,p_request,p_digest,p_operation,p_daily,p_budget);
 end if;
 select cost into strict actual from public.loox_operations where id=p_operation for share;
 if actual<>p_expected_cost then raise exception 'price_changed'; end if;
 return public.loox_reserve(p_user,p_request,p_digest,p_operation,p_daily,p_budget);
end $$;
revoke all on function public.loox_reserve_quoted(uuid,uuid,text,text,integer,bigint,integer) from public,anon,authenticated;
grant execute on function public.loox_reserve_quoted(uuid,uuid,text,text,integer,bigint,integer) to service_role;
commit;
