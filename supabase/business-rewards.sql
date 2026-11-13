begin;
update public.loox_plans set credits=case id when 'creator' then 150 when 'creator_yearly' then 1800 when 'pro' then 400 when 'pro_yearly' then 4800 else credits end;
insert into public.loox_plans values('business',6900,1000,'month'),('business_yearly',69000,12000,'year') on conflict(id) do update set credits=excluded.credits,price_cents=excluded.price_cents;
do $$declare d text;begin
select pg_get_functiondef('public.loox_reward(uuid,text,boolean)'::regprocedure) into d;
d:=replace(replace(replace(replace(replace(replace(d,'w.balance>=10','w.balance>=50'),'w.balance<10','w.balance<50'),'balance=balance+1','balance=balance+5'),'''Return reward'',1,','''Return reward'',5,'),'''credits'',1','''credits'',5'),'''balance_cap'',10','''balance_cap'',50');execute d;
select pg_get_functiondef('public.loox_member_tier(uuid)'::regprocedure) into d;d:=replace(d,'''pro'',''pro_yearly''','''pro'',''pro_yearly'',''business'',''business_yearly''');execute d;
end $$;
commit;