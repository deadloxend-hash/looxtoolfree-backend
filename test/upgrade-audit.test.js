import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createWorkflowRunner,workflowCatalog} from '../lib/workflows.js';
import {videoCapabilities} from '../lib/video-capabilities.js';
import {videoModelInput,videoQuote} from '../lib/video-cloud.js';
test('current pricing and reward migrations preserve atomic generation, release and check-in ledger',async()=>{
 const db=new PGlite();try{
  await db.exec(`create schema auth;create schema storage;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;create table storage.buckets(id text,name text,public boolean);`);
  for(const file of ['platform.sql','membership-rewards.sql','business-rewards.sql','pricing-2026-11-13.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261119154336_quoted_credit_reservations.sql',import.meta.url),'utf8'));
  const u=randomUUID(),fp='a'.repeat(64),q=(s,a=[])=>db.query(s,a),one=async(s,a)=>(await q(s,a)).rows[0],balance=async()=>Number((await one('select balance from loox_wallets where user_id=$1',[u])).balance);
  await q('insert into auth.users values($1)',[u]);await q("select loox_account($1,'Creator',$2,'2026-11')",[u,fp]);assert.equal(await balance(),25);
  assert.deepEqual((await q("select id,credits from loox_plans where id in ('free','creator','pro','business') order by credits")).rows.map(x=>[x.id,x.credits]),[['free',25],['creator',500],['pro',1500],['business',4000]]);
  const reserve=(id,digest='same')=>one("select loox_reserve($1,$2,$3,'generate',1000000000,99999999) as job",[u,id,digest]).then(x=>x.job);
  await assert.rejects(q("select loox_reserve_quoted($1,$2,'quoted','generate',25,99999999,1)",[u,randomUUID()]),/price_changed/);assert.equal(await balance(),25);
  const quoted=(await one("select loox_reserve_quoted($1,$2,'quoted','generate',25,99999999,3) as job",[u,randomUUID()])).job;assert.equal(await balance(),22);await q('select loox_finish($1,null)',[quoted.id]);
  const request=randomUUID(),jobs=await Promise.all([reserve(request),reserve(request)]);assert.equal(jobs[0].id,jobs[1].id);assert.equal(jobs.filter(j=>j.fresh).length,1);assert.equal(await balance(),22);
  await assert.rejects(reserve(request,'changed'),/idempotency_conflict/);
  await q('select loox_finish($1,$2)',[jobs[0].id,'private.png']);await q('select loox_finish($1,null)',[jobs[0].id]);assert.equal(await balance(),22);
  const failed=await reserve(randomUUID());assert.equal(await balance(),19);await Promise.all([q('select loox_finish($1,null)',[failed.id]),q('select loox_finish($1,null)',[failed.id])]);assert.equal(await balance(),22);
  await q('select loox_reward($1,$2,false)',[u,fp]);
  await q("update loox_return_rewards set next_claim_at=now()-interval '1 hour'");
  const claim=()=>one('select loox_reward($1,$2,true) as reward',[u,fp]);const rewards=await Promise.allSettled([claim(),claim()]);assert.equal(rewards.filter(x=>x.status==='fulfilled').length,1);assert.equal(await balance(),27);await assert.rejects(claim(),/reward_not_ready/);
  await q('update loox_wallets set balance=3 where user_id=$1',[u]);const competing=await Promise.allSettled([reserve(randomUUID()),reserve(randomUUID())]);assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);assert.equal(await balance(),0);
  await db.exec('set role authenticated');await assert.rejects(q('update loox_wallets set balance=999'),/permission denied/);await assert.rejects(claim(),/permission denied/);
 }finally{await db.close();}
});
test('workflow runner maps approved steps server-side and shares the existing request ID',async()=>{
 let captured;const run=createWorkflowRunner({image:async(u,b)=>{captured=b;return {id:'job'};}}),requestId=randomUUID();
 assert.equal((await run({id:'owner'},{workflow:'product-photo',model:'flux',prompt:'A glass bottle',ratio:'1:1',requestId,credits:0,operation:'free_money'})).id,'job');
 assert.equal(captured.operation,'generate');assert.equal(captured.requestId,requestId);assert.match(captured.prompt,/Professional product/);assert.equal(captured.credits,undefined);
 await assert.rejects(run({}, {workflow:'unimplemented',requestId}),e=>e.status===400);
 assert.ok(workflowCatalog().items.every(w=>w.steps.length===3&&w.runnable));
});
test('video capabilities fail closed and respect paid adapter limits',()=>{
 assert.equal(videoCapabilities('unknown').startFrame,false);assert.equal(videoCapabilities('flux3_video').textToVideo,false);
 assert.deepEqual(videoCapabilities('wan22_t2v_fast').ratios,['16:9','9:16']);assert.equal(videoCapabilities('wan22_t2v_fast').startFrame,false);
 assert.equal(videoCapabilities('kling_40_flash').endFrame,false);assert.deepEqual(videoCapabilities('veo_31_fast').endFrameDurations,[8]);
 assert.equal(videoModelInput({id:'minimax_h3'},{prompt:'a fox',duration:5,ratio:'16:9'},'start','end').ratio,'adaptive');
 assert.throws(()=>videoQuote({id:'u'},{model:'wan22_t2v_fast',duration:5,ratio:'1:1'},[{id:'video_wan22_t2v_fast',cost:15}]),/aspect ratio/);
});
