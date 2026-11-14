import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import sharp from 'sharp';
import {modelInput,status,start} from '../lib/jobs.js';
import {billingEvent} from '../lib/billing.js';
import payment from '../api/loox-payment.js';
import api from '../api/loox.js';
import {Readable} from 'node:stream';

test('ledger, budgets, billing replay, RLS and deletion against PostgreSQL WASM',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create schema auth;create schema storage;create role anon;create role authenticated;create role service_role bypassrls;
  create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated;create table storage.buckets(id text,name text,public boolean);`);
  await db.exec(await readFile(new URL('../supabase/platform.sql',import.meta.url),'utf8'));
  const u=randomUUID(),v=randomUUID(),q=(sql,args=[])=>db.query(sql,args),one=async(sql,args)=>(await q(sql,args)).rows[0];
  const wallet=async()=>Number((await one('select balance from loox_wallets where user_id=$1',[u])).balance);
  await q('insert into auth.users values ($1),($2)',[u,v]);
  const onboard=(id,fp)=>q("select loox_account($1,'Creator',$2,'2026-11')",[id,fp]);
  await onboard(u,'first');await onboard(u,'first');await onboard(v,'second');assert.equal(await wallet(),10);
  await db.exec(await readFile(new URL('../supabase/cloud-image-models.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/cloud-image-quota.sql',import.meta.url),'utf8'));
  const imageOne=(await q("select loox_reserve($1,$2,'image-quota-one','generate_google',1,9999999) as job",[u,randomUUID()])).rows[0].job;
  await assert.rejects(q("select loox_reserve($1,$2,'image-quota-two','generate_stability',1,9999999)",[u,randomUUID()]),/daily_generation_limit/);
  await q('select loox_finish($1,null)',[imageOne.id]);assert.equal(await wallet(),10);
  const reserve=(id,d='digest',op='upscale4',budget=9999999)=>one("select loox_reserve($1,$2,$3,$4,20,$5) as job",[u,id,d,op,budget]).then(v=>v.job);
  const id=randomUUID(),[a,b]=await Promise.all([reserve(id),reserve(id)]);assert.equal(a.id,b.id);assert.notEqual(a.fresh,b.fresh);assert.equal(await wallet(),6);
  await assert.rejects(reserve(id,'different'),/idempotency_conflict/);
  const c=await reserve(randomUUID());assert.equal(await wallet(),2);await assert.rejects(reserve(randomUUID()),/insufficient_credits/);
  const finish=(id,path=null)=>q('select loox_finish($1,$2)',[id,path]);
  await finish(a.id);await finish(a.id);assert.equal(await wallet(),6);await finish(c.id,'private.png');await finish(c.id);assert.equal(await wallet(),6);
  await assert.rejects(reserve(randomUUID(),'digest','background',1),/budget_limit/);assert.equal(await wallet(),6);
  const bill=(status,ref='subscription-invoices/9')=>q("select loox_billing($1,'pro',$2,$3,999,'USD',null,now(),null)",[u,ref,status]);
  await bill('paid');await bill('paid');await bill('failed');assert.equal(await wallet(),106);await bill('refunded');await bill('paid');assert.equal(await wallet(),6);
  await bill('refunded','early');await bill('paid','early');assert.equal(await wallet(),6);
  const cloud=await reserve(randomUUID(),'cloud','generate_bfl');assert.equal(await wallet(),0);
  await finish(cloud.id);assert.equal(await wallet(),6);
  await q("select loox_rate('account-test',1,30)");await assert.rejects(q("select loox_rate('account-test',1,30)"),/rate_limited/);
  await db.exec("set role authenticated");await q("select set_config('request.jwt.claim.sub',$1,false)",[v]);
  assert.equal((await q('select * from loox_jobs')).rows.length,0);assert.deepEqual((await q('select user_id from loox_wallets')).rows,[{user_id:v}]);
  await assert.rejects(q('update loox_wallets set balance=999'),/permission denied/);await assert.rejects(onboard(v,'bogus'),/permission denied/);
  await db.exec('reset role;set role anon');await assert.rejects(q('select * from loox_profiles'),/permission denied/);await db.exec('reset role');
  await q('select loox_begin_delete($1)',[u]);await assert.rejects(reserve(randomUUID()),/account_unavailable/);
  await q('delete from auth.users where id=$1',[u]);await q('insert into auth.users values ($1)',[u]);await onboard(u,'first');assert.equal(await wallet(),0);
 }finally{await db.close();}
});
test('model contracts, media decoding and mask dimensions',async()=>{
 const make=async(w,h,color)=>'data:image/png;base64,'+(await sharp({create:{width:w,height:h,channels:4,background:color}}).png().toBuffer()).toString('base64');
 const source=await make(16,10,'white');const b={requestId:randomUUID(),image:source,permission:true};
 assert.equal((await modelInput({...b,operation:'upscale4'})).upscale_factor,'x4');
 assert.equal((await modelInput({...b,operation:'background'})).preserve_alpha,true);
 await assert.rejects(modelInput({...b,operation:'erase',mask:await make(8,9,'white')}),/match/);
 await assert.rejects(modelInput({...b,operation:'erase',mask:await make(16,10,'black')}),/Select the area/);
 assert.ok((await modelInput({...b,operation:'erase',mask:source})).mask);
 assert.equal((await modelInput({...b,operation:'fill',mask:source,prompt:'a garden'})).prompt,'a garden');
 await assert.rejects(modelInput({...b,operation:'fill',mask:source,prompt:''}),/Describe/);
 await assert.rejects(modelInput({...b,operation:'background',image:source.replace('png','jpeg')}),/format/);
 await assert.rejects(modelInput({...b,operation:'background',image:'https://localhost'}),/Choose/);
 assert.deepEqual(await modelInput({...b,operation:'generate',prompt:' Sky ',ratio:'1:1',seed:0}),{prompt:'Sky',aspect_ratio:'1:1',num_outputs:1,output_format:'png',seed:0});
 assert.deepEqual(await modelInput({...b,operation:'generate_video',prompt:' Fox running ',ratio:'16:9',seed:0}),{prompt:'Fox running',aspect_ratio:'16:9',num_outputs:1,output_format:'mp4',seed:0});
});
function response(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(x){this.data=x;return this;},end(){}};}
test('unconfigured service fails closed and unapproved origins are rejected',async()=>{
 const a=response();await api({method:'GET',query:{action:'config'},headers:{}},a);assert.equal(a.data.auth,false);assert.equal(a.data.ai,false);assert.equal(a.data.billing,false);
 const b=response();await api({method:'GET',query:{action:'config'},headers:{origin:'https://untrusted.example'}},b);assert.equal(b.code,403);
 const c=response();await api({method:'POST',query:{action:'job'},headers:{}},c);assert.equal(c.code,503);
});
test('configured boundary requires identity, owner filter and an authentic billing signature',async t=>{
 const u=randomUUID();Object.assign(process.env,{SUPABASE_URL:'https://project.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-server',SUPABASE_PUBLISHABLE_KEY:'test-public',LOOX_IDENTITY_SECRET:'test-identity',LEMON_MODE:'live',LEMON_STORE_ID:'42',LEMON_PRO_VARIANT:'1',LEMON_LIFETIME_VARIANT:'2',LEMON_API_KEY:'test-key',LEMON_WEBHOOK_SECRET:'test-signing'});
 const n=response();await api({method:'POST',query:{action:'job'},headers:{}},n);assert.equal(n.code,401);
 const calls=[];t.mock.method(globalThis,'fetch',async url=>{calls.push(String(url));return Response.json(String(url).endsWith('loox_claim_payment_event')?true:[]);});
 await assert.rejects(status({id:u},randomUUID()),/not found/);assert.ok(calls[0].includes('user_id=eq.'+u));
 await assert.rejects(start({id:u},{}),/not configured/);
 const payload=Buffer.from(JSON.stringify({meta:{event_name:'order_created'},data:{id:'10',type:'orders',attributes:{store_id:42,test_mode:true}}}));
 const invoke=async sig=>{const req=Readable.from([payload]);Object.assign(req,{method:'POST',headers:{'x-signature':sig}});const res=response();await payment(req,res);return res.code;};
 assert.equal(await invoke('forged'),403);assert.equal(await invoke(createHmac('sha256','test-signing').update(payload).digest('hex')),204);
 await assert.rejects(billingEvent({meta:{custom_data:{loox_user:u,loox_binding:'tamper',loox_plan:'lifetime'}},data:{type:'orders',attributes:{test_mode:false,store_id:42,first_order_item:{variant_id:2}}}}),/binding/);
});
