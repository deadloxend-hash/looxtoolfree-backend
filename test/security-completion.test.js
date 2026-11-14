import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {reconcileProvider} from '../src/billing/reconciliation.js';
import {requireAdmin} from '../src/security/admin.js';

test('all admin policies require MFA while public templates remain visible; failure circuit requires independent users and blocks costs atomically',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create schema storage;create schema loox_private;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to authenticated;
 create table storage.buckets(id text,name text,public boolean);`);
 await db.exec(await readFile(new URL('../supabase/platform.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261114033906_billing_security_foundation.sql',import.meta.url),'utf8'));
 await db.exec(`create table public.loox_moderation_log(admin_id uuid,action text,reason text);
 create table loox_template_catalog(id text primary key,active boolean);alter table loox_template_catalog enable row level security;
 create policy browse_original_templates on loox_template_catalog for select to authenticated using(active);
 create policy loox_admin_catalog_read on loox_template_catalog for select to authenticated using(auth.jwt()->'app_metadata'->>'loox_template_admin'='true');
 create policy loox_admin_catalog_insert on loox_template_catalog for insert to authenticated with check(auth.jwt()->'app_metadata'->>'loox_template_admin'='true');
 create table loox_template_categories(id text primary key);create table loox_template_styles(id text primary key);
 create table loox_community_posts(id uuid primary key,creator_id uuid);alter table loox_community_posts enable row level security;
 create function loox_private.public_post(uuid) returns boolean language sql as $$select false$$;
 create policy visible_posts on loox_community_posts for select to authenticated using(true);
 grant select,insert on loox_template_catalog to authenticated;
 insert into loox_template_catalog values('public',true),('private',false);`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261114043044_admin_mfa_and_cost_circuit_breaker.sql',import.meta.url),'utf8'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);
 await db.exec(`set role authenticated;select set_config('request.jwt.claims','{"aal":"aal1","app_metadata":{"loox_template_admin":true}}',false)`);
 assert.equal((await db.query('select count(*) as n from loox_template_catalog')).rows[0].n,1);
 await assert.rejects(db.query("insert into loox_template_catalog values('blocked',true)"),/row-level security/);
 await db.exec(`select set_config('request.jwt.claims','{"aal":"aal2","app_metadata":{"loox_template_admin":true}}',false)`);
 await db.query("insert into loox_template_catalog values('allowed',true)");assert.equal((await db.query('select count(*) as n from loox_template_catalog')).rows[0].n,3);await db.exec('reset role');assert.equal((await db.query('select count(*) as n from loox_moderation_log')).rows[0].n,1);
 const users=[randomUUID(),randomUUID(),randomUUID()];
 for(const id of users){await db.query('insert into auth.users values($1)',[id]);await db.query("select loox_account($1::uuid,'Test',$1::text,'2026-11')",[id]);}
 const job=async user=>(await db.query("select loox_reserve($1,$2,$3,'generate',100,99999999) as job",[user,randomUUID(),randomUUID()])).rows[0].job.id;
 for(let i=0;i<8;i++){const id=await job(users[0]);await db.query('select loox_finish($1,null)',[id]);}
 assert.equal((await db.query('select count(*) as n from loox_model_circuits')).rows[0].n,0,'One client must not trip a shared model');
 for(const u of users.slice(1)){const id=await job(u);await db.query('select loox_finish($1,null)',[id]);}
 const [circuit]=(await db.query('select * from loox_model_circuits')).rows;assert.equal(circuit.operation,'generate');assert.equal(circuit.distinct_users,3);
 const balance=(await db.query('select balance from loox_wallets where user_id=$1',[users[0]])).rows[0].balance;
 await assert.rejects(job(users[0]),/model_circuit_open/);assert.equal((await db.query('select balance from loox_wallets where user_id=$1',[users[0]])).rows[0].balance,balance);
 assert.equal((await db.query("select count(*) as n from loox_security_alerts where category='generation_failure'")).rows[0].n,1);
 await db.query("update loox_model_circuits set paused_until=now()-interval '1 minute'");const recovered=await job(users[0]);assert.ok(recovered);
 const snapshot=(await db.query('select budget_estimate_millicents from loox_jobs where id=$1',[recovered])).rows[0].budget_estimate_millicents;assert.equal(Number(snapshot),1000);
 }finally{await db.close();}
});

test('provider reconciliation traverses every page, handles partial refunds and rejects forged or cross-admin cursors',async t=>{
 Object.assign(process.env,{LEMON_API_KEY:'test-key',LEMON_STORE_ID:'1',LEMON_MODE:'test',SUPABASE_URL:'https://unit.invalid',LOOX_IDENTITY_SECRET:'unit-only'});
 const all=Array.from({length:23},(_,i)=>({reference:'subscription-invoices/'+String(i+1).padStart(3,'0'),amount_cents:1000,currency:'USD',status:i===0?'partially_refunded':'paid'}));
 const admin={id:randomUUID()};let providerCalls=0;
 t.mock.method(globalThis,'fetch',async input=>{
  const u=new URL(input);
  if(u.hostname==='api.lemonsqueezy.com'){providerCalls++;const ref=u.pathname.replace('/v1/','');return Response.json({data:{type:'subscription-invoices',id:ref.split('/')[1],attributes:{store_id:1,test_mode:true,currency:'USD',total:1000,refunded_amount:ref.endsWith('/001')?250:0,status:'paid'}}});}
  if(u.pathname.endsWith('/loox_payments')){const after=u.searchParams.get('reference')?.slice(3)||'';assert.equal(u.searchParams.get('order'),'reference.asc');return Response.json(all.filter(p=>p.reference>after).slice(0,11));}
  if(u.pathname.endsWith('/loox_recharge_payments'))return Response.json([]);
  if(u.pathname.endsWith('/loox_invoice_refunds'))return Response.json([{reference:all[0].reference,refunded_cents:250}]);
  if(u.pathname.endsWith('/loox_financial_audit'))return Response.json(null);
  throw Error('Unexpected request '+u.pathname);
 });
 const first=await reconcileProvider(admin);assert.equal(first.checked,10);assert.equal(first.complete,false);
 await assert.rejects(reconcileProvider({id:randomUUID()},first.nextCursor),e=>e.status===400);
 await assert.rejects(reconcileProvider(admin,first.nextCursor+'x'),e=>e.status===400);
 let page=first;for(let i=0;i<5&&!page.complete;i++)page=await reconcileProvider(admin,page.nextCursor);
 assert.equal(page.complete,true);assert.equal(page.verified,true);assert.equal(page.totalChecked,23);assert.equal(providerCalls,23);assert.equal(page.totalMismatches,0);
});

test('encrypted backups round-trip and reject tampering or the wrong recovery key',async()=>{
 const {sealBackup,openBackup,backupKey}=await import('../src/recovery/encrypted-backup.js');
 const {randomBytes}=await import('node:crypto');
 const key=backupKey(randomBytes(32).toString('base64')),fixture=Buffer.from('Synthetic PostgreSQL backup fixture; no production data.');
 const sealed=sealBackup(fixture,key);assert.notEqual(sealed.indexOf(fixture),0);assert.deepEqual(openBackup(sealed,key),fixture);
 const damaged=Buffer.from(sealed);damaged[25]^=1;assert.throws(()=>openBackup(damaged,key));assert.throws(()=>openBackup(sealed,randomBytes(32)));assert.throws(()=>backupKey('invalid'));
});

test('model health removes paused durations and retains healthy alternatives',async()=>{
 const {applyModelHealth}=await import('../src/generation/model-health.js');
 const c={local:{available:true,referenceAvailable:true},models:[{id:'image',operation:'generate_z_image',available:true}],videoModels:[{id:'video',operation:'video_sample',available:true,durationOptions:[5,10]}],faceSwap:{available:true}};
 const updated=applyModelHealth(c,['generate_z_image','video_sample_10','generate_reference']);
 assert.equal(updated.models[0].available,false);assert.deepEqual(updated.videoModels[0].durationOptions,[5]);assert.equal(updated.videoModels[0].available,true);assert.equal(updated.local.referenceAvailable,false);
});

test('real template upload endpoint rejects password-only admins and ordinary members before signing media',async t=>{
 const {r2MediaAction}=await import('../lib/r2-media.js');
 const user={id:randomUUID(),email:'test@example.invalid',email_confirmed_at:new Date().toISOString(),user_metadata:{loox_terms:'2026-11'},app_metadata:{loox_template_admin:true}};
 Object.assign(process.env,{SUPABASE_URL:'https://unit.invalid',SUPABASE_PUBLISHABLE_KEY:'test-public',SUPABASE_SERVICE_ROLE_KEY:'test-server',LOOX_IDENTITY_SECRET:'test-only',LOOX_R2_ACCOUNT_ID:'a'.repeat(32),LOOX_R2_BUCKET:'test-bucket',LOOX_R2_ACCESS_KEY_ID:'test-key',LOOX_R2_SECRET_ACCESS_KEY:'test-secret'});
 t.mock.method(globalThis,'fetch',async input=>{const u=new URL(input);assert.equal(u.hostname,'unit.invalid','No media request is allowed before authorization');return Response.json(u.pathname==='/auth/v1/user'?user:null);});
 const request=(aal,extra={})=>({method:'POST',query:{},headers:{'content-type':'application/json',authorization:'Bearer '+Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,iss:'https://unit.invalid/auth/v1',aud:'authenticated',exp:Date.now()/1000+300,aal,...extra})).toString('base64url')+'.testsignature'},body:{purpose:'template_video_prepare',bytes:1000}});
 const response={json:x=>x};await assert.rejects(r2MediaAction(request('aal1'),response),e=>e.status===403);
 user.app_metadata={};await assert.rejects(r2MediaAction(request('aal2'),response),e=>e.status===403);
 user.app_metadata={loox_template_admin:true};await assert.rejects(r2MediaAction(request('aal2',{exp:1}),response),e=>e.status===401);
 const prepared=await r2MediaAction(request('aal2'),response);assert.ok(prepared.path.startsWith('public/templates/'+user.id+'/'));assert.equal(prepared.max_bytes,40000000);
});

test('Cloudflare administrator API enforces verified MFA and rejects forged issuer/expiry claims',async t=>{
 const worker=(await import('../cloudflare/loox-profile-api.js')).default;
 const u={id:randomUUID(),email_confirmed_at:new Date().toISOString(),app_metadata:{loox_template_admin:true}};
 t.mock.method(globalThis,'fetch',async input=>{assert.equal(new URL(input).hostname,'unit.invalid');return Response.json(u);});
 const env={SUPABASE_URL:'https://unit.invalid',SUPABASE_PUBLISHABLE_KEY:'test-public',DB:{prepare(){return {bind(){return {run:async()=>({meta:{changes:1}}),first:async()=>({posts:0})}}}}}};
 const request=(aal,extra={})=>new Request('https://worker.invalid/v1/admin-stats',{headers:{Authorization:'Bearer '+Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:u.id,iss:'https://unit.invalid/auth/v1',aud:'authenticated',exp:Date.now()/1000+60,aal,...extra})).toString('base64url')+'.testsignature'}});
 assert.equal((await worker.fetch(request('aal1'),env)).status,403);
 assert.equal((await worker.fetch(request('aal2',{exp:1}),env)).status,401);
 assert.equal((await worker.fetch(request('aal2',{iss:'https://attacker.invalid'}),env)).status,401);
 assert.equal((await worker.fetch(request('aal2'),env)).status,200);
 u.app_metadata={};assert.equal((await worker.fetch(request('aal2'),env)).status,403);
});
