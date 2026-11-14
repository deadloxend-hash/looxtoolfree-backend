begin;
-- Preserve the existing payment schema; snapshot cumulative refund accounting separately.
create table public.loox_invoice_refunds (
 reference text primary key,user_id uuid not null,total_cents integer not null check(total_cents>0),
 granted_credits integer not null check(granted_credits>=0),refunded_cents integer not null default 0,
 reversed_credits integer not null default 0,updated_at timestamptz not null default now(),
 check(refunded_cents between 0 and total_cents),check(reversed_credits between 0 and granted_credits)
);
alter table public.loox_invoice_refunds enable row level security;
revoke all on public.loox_invoice_refunds from public,anon,authenticated;
grant select,insert,update on public.loox_invoice_refunds to service_role;
create function public.loox_invoice_settle(p_user uuid,p_plan text,p_reference text,p_total integer,p_refunded integer,p_status text,p_updated timestamptz)
returns void language plpgsql set search_path='' as $$
declare pay public.loox_payments; f public.loox_invoice_refunds; grant_size integer; target integer; delta integer;
begin
 if p_reference !~ '^subscription-invoices/[0-9]+$' or p_total<=0 or p_refunded<0 or p_refunded>p_total or p_status not in ('paid','failed') then raise exception 'invalid_payment';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_reference,0));
 perform 1 from public.loox_wallets where user_id=p_user for update;
 select * into pay from public.loox_payments where reference=p_reference;
 if found and (pay.user_id<>p_user or pay.plan<>p_plan or pay.amount_cents<>p_total) then raise exception 'invalid_payment';end if;
 if p_status='failed' then
 perform public.loox_billing(p_user,p_plan,p_reference,'failed',p_total,'USD',null,p_updated,null);return;
 end if;
 select * into f from public.loox_invoice_refunds where reference=p_reference;
 if not found then
  if pay.status='refunded' then
   -- Historical full reversals stay terminal; never re-grant their allowance.
   select coalesce(sum(amount),0) into grant_size from public.loox_credits where user_id=p_user and reference=p_reference and reason='Purchase';
   insert into public.loox_invoice_refunds values(p_reference,p_user,p_total,grant_size,p_total,grant_size,now());return;
  end if;
  perform public.loox_billing(p_user,p_plan,p_reference,'paid',p_total,'USD',null,p_updated,null);
  select credits into strict grant_size from public.loox_payments where reference=p_reference;
  insert into public.loox_invoice_refunds(reference,user_id,total_cents,granted_credits) values(p_reference,p_user,p_total,grant_size) returning * into f;
 end if;
 target:=ceil(f.granted_credits::numeric*p_refunded/f.total_cents)::integer;
 delta:=greatest(target-f.reversed_credits,0);
 if delta>0 then
  update public.loox_wallets set balance=greatest(0,balance-delta),debt=debt+greatest(0,delta-balance) where user_id=p_user;
  insert into public.loox_credits(user_id,reason,amount,reference) values(p_user,'Subscription refund',-delta,p_reference||'/'||target);
  update public.loox_invoice_refunds set refunded_cents=p_refunded,reversed_credits=target,updated_at=now() where reference=p_reference;
  update public.loox_payments set status=case when target>=f.granted_credits then 'refunded' else 'partially_refunded' end where reference=p_reference;
 end if;
end $$;
revoke all on function public.loox_invoice_settle(uuid,text,text,integer,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.loox_invoice_settle(uuid,text,text,integer,integer,text,timestamptz) to service_role;
commit;
