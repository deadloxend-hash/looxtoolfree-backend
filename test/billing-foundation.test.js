import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {checkout,checkoutPlans} from '../lib/billing.js';
import {rechargeCheckout} from '../src/billing/topups.js';
import {paymentsEnabled,topupsEnabled} from '../src/config/billing.js';
import {requireFinancialAdmin} from '../src/security/admin.js';
import {handler,json} from '../lib/core.js';
test('purchase gates default off and annual tampering fails before provider access',async()=>{
 delete process.env.PAYMENTS_ENABLED;delete process.env.CREDIT_TOPUPS_ENABLED;delete process.env.ANNUAL_BILLING_ENABLED;
 process.env.LEMON_PRO_YEARLY_VARIANT='999';assert.equal(paymentsEnabled(),false);assert.equal(topupsEnabled(),false);assert.ok(!checkoutPlans().includes('pro_yearly'));
 await assert.rejects(checkout({id:randomUUID()},'pro_yearly'),e=>e.status===403);
 await assert.rejects(checkout({id:randomUUID()},'pro'),e=>e.status===503);
 await assert.rejects(rechargeCheckout({id:randomUUID()},'mini'),e=>e.status===503);
 assert.throws(()=>json({headers:{'content-type':'application/json'},body:'[]'}),e=>e.status===400);
});
test('recharge ledger: concurrent replay, ownership, partial/full refund, refund-first, debt and RLS',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create schema storage;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;create table storage.buckets(id text,name text,public boolean);`);
 await db.exec(await readFile(new URL('../supabase/platform.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261114033906_billing_security_foundation.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261114034903_billing_health_monitoring.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261114040822_proportional_subscription_refunds.sql',import.meta.url),'utf8'));
 const u=randomUUID(),v=randomUUID(),q=(s,a=[])=>db.query(s,a),balance=async()=>Number((await q('select balance from loox_wallets where user_id=$1',[u])).rows[0].balance);
 await q('insert into auth.users values($1),($2)',[u,v]);for(const id of [u,v])await q("select loox_account($1::uuid,'Test',$1::text,'2026-11')",[id]);
 const settle=(ref,refund=0,id=u)=>q("select loox_recharge_settle($1,$2,'mini',100,500,$3,false)",[id,ref,refund]);
 await Promise.all([settle('orders/1'),settle('orders/1')]);assert.equal(await balance(),110);
 await assert.rejects(settle('orders/1',0,v),/invalid_payment/);
 await settle('orders/1',100);assert.equal(await balance(),90);await settle('orders/1',100);assert.equal(await balance(),90);
 await settle('orders/1',500);assert.equal(await balance(),10);await settle('orders/1');assert.equal(await balance(),10);
 await settle('orders/2',500);assert.equal(await balance(),10);await settle('orders/2');assert.equal(await balance(),10);
 await settle('orders/3');await q('update loox_wallets set balance=0 where user_id=$1',[u]);await settle('orders/3',500);assert.equal(await balance(),0);assert.equal((await q('select debt from loox_wallets where user_id=$1',[u])).rows[0].debt,100);
 const invoice=(ref,refund=0,id=u)=>q("select loox_invoice_settle($1,'pro',$2,1000,$3,'paid',now())",[id,ref,refund]);
 const before=await balance();await Promise.all([invoice('subscription-invoices/81'),invoice('subscription-invoices/81')]);assert.equal(await balance(),before+0); // existing refund debt consumes the allowance
 await invoice('subscription-invoices/81',250);assert.equal((await q('select debt from loox_wallets where user_id=$1',[u])).rows[0].debt,25);
 await invoice('subscription-invoices/81',1000);assert.equal((await q('select debt from loox_wallets where user_id=$1',[u])).rows[0].debt,100);
 await invoice('subscription-invoices/81');assert.equal((await q('select debt from loox_wallets where user_id=$1',[u])).rows[0].debt,100);
 await assert.rejects(invoice('subscription-invoices/81',0,v),/invalid_payment/);
 await invoice('subscription-invoices/82',1000);assert.equal((await q('select debt from loox_wallets where user_id=$1',[u])).rows[0].debt,100);
 const event=()=>q("select loox_claim_payment_event('digest','order_created','orders/1') as claimed");assert.equal((await event()).rows[0].claimed,true);assert.equal((await event()).rows[0].claimed,false);
 await q("update loox_payment_events set status='failed'");assert.equal((await event()).rows[0].claimed,true);
 await q("select loox_security_incident('key','simulated','high','monitoring')");await q("select loox_security_incident('key','simulated','high','monitoring')");assert.equal((await q('select occurrences from loox_security_alerts')).rows[0].occurrences,2);
 assert.equal((await q('select * from loox_claim_alerts()')).rows.length,1);assert.equal((await q('select * from loox_claim_alerts()')).rows.length,0);
 assert.ok((await q('select * from loox_balance_changes')).rows.length>0);
 await db.exec('set role authenticated');await assert.rejects(settle('orders/4'),/permission denied/);await assert.rejects(q('select * from loox_recharge_payments'),/permission denied/);await assert.rejects(q('update loox_wallets set balance=10000'),/permission denied/);await db.exec('reset role');
 await q('update loox_wallets set balance=100,debt=0 where user_id=$1',[u]);await q('update loox_cost_controls set user_daily_millicents=1');await assert.rejects(q("select loox_reserve($1,$2,'digest','generate',25,999999999)",[u,randomUUID()]),/budget_limit/);assert.equal(await balance(),100);
 const health=(await q('select loox_billing_health() as health')).rows[0].health;assert.ok(health.wallet_mismatches>0);assert.equal(health.provider_reconciled,false);
 }finally{await db.close();}
});

test('financial admin requires server role and verified MFA; worker replay tokens are consumed once',async t=>{
 const {verifyWorkerSignature}=await import('../src/security/worker-signature.js');
 const {createHmac,createHash}=await import('node:crypto');
 const user={id:randomUUID(),app_metadata:{loox_template_admin:true}};
 process.env.SUPABASE_URL='https://unit.invalid';process.env.LOOX_WORKER_SECRET='worker-test-secret';
 let nonceCalls=0;
 t.mock.method(globalThis,'fetch',async(url)=>{if(String(url).endsWith('loox_worker_nonce')){nonceCalls++;return nonceCalls===1?Response.json(null):Response.json({message:'worker_replay'},{status:400});}return Response.json(null);});
 await assert.rejects(requireFinancialAdmin({looxAuthClaims:{sub:user.id,aal:'aal1',exp:Date.now()/1000+30}},user),e=>e.status===403);
 await assert.rejects(requireFinancialAdmin({looxAuthClaims:{sub:user.id,aal:'aal2',exp:Date.now()/1000+30}},{...user,app_metadata:{}}),e=>e.status===403);
 await requireFinancialAdmin({looxAuthClaims:{sub:user.id,aal:'aal2',exp:Date.now()/1000+30}},user);
 const body=Buffer.from('{"modes":["generate"]}'),ts=String(Math.floor(Date.now()/1000)),nonce='a'.repeat(32);
 const sig=createHmac('sha256',process.env.LOOX_WORKER_SECRET).update(['POST','claim',ts,nonce,createHash('sha256').update(body).digest('hex')].join('\n')).digest('hex');
 const req={query:{action:'claim'},headers:{'x-loox-timestamp':ts,'x-loox-nonce':nonce,'x-loox-signature':sig}};
 await verifyWorkerSignature(req,body);await assert.rejects(verifyWorkerSignature(req,body),e=>e.status===409);
 await assert.rejects(verifyWorkerSignature(req,Buffer.from('{}')),e=>e.status===401);
 process.env.LOOX_WORKER_SIGNED_REQUESTS_REQUIRED='true';await assert.rejects(verifyWorkerSignature({headers:{},query:{}},body),e=>e.status===401);
 delete process.env.LOOX_WORKER_SIGNED_REQUESTS_REQUIRED;
});

test('alert emails use safe fixed templates, provider idempotency and verified delivery status',async t=>{
 const {deliverAlerts}=await import('../src/notifications/security-alerts.js');
 Object.assign(process.env,{SECURITY_ALERT_EMAIL:'admin@example.invalid',SECURITY_ALERT_FROM:'LOOX <security@example.invalid>',RESEND_API_KEY:'test-only'});
 const id=randomUUID();let sent,marked=false;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).endsWith('loox_claim_alerts'))return Response.json([{id,category:'simulated',created_at:'2026-11-14T00:00:00Z'}]);
  if(String(url)==='https://api.resend.com/emails'){sent={headers:options.headers,body:JSON.parse(options.body)};return Response.json({id:'mock-message'});}
  if(String(url).includes('loox_security_alerts')){marked=JSON.parse(options.body).sent_at!=null;return Response.json(null);}
  throw Error('Unexpected network call');
 });
 assert.deepEqual(await deliverAlerts(),{configured:true,sent:1});assert.equal(marked,true);assert.equal(sent.headers['Idempotency-Key'],'loox-alert-'+id);assert.match(sent.body.text,/Safe simulated/);assert.equal(sent.body.text.includes('test-only'),false);
 delete process.env.SECURITY_ALERT_EMAIL;delete process.env.SECURITY_ALERT_FROM;delete process.env.RESEND_API_KEY;
});
