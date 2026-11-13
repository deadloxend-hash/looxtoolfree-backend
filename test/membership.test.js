import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {videoModelInput,videoCapabilities,videoQuote,videoCatalog} from '../lib/video-cloud.js';
test('reward cooldown, replay, deletion resistance, entitlements and annual accounting',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create schema storage;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;grant usage on schema auth to authenticated;create table storage.buckets(id text,name text,public boolean);`);
 await db.exec(await readFile(new URL('../supabase/platform.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/membership-rewards.sql',import.meta.url),'utf8'));
 const u=randomUUID(),fp='a'.repeat(64),q=(sql,args=[])=>db.query(sql,args),one=async(sql,args)=>(await q(sql,args)).rows[0];
 await q('insert into auth.users values($1)',[u]);await q("select loox_account($1,'Test',$2,'2026-11')",[u,fp]);
 const reward=claim=>one('select loox_reward($1,$2,$3) as r',[u,fp,claim]).then(x=>x.r);
 const r=await reward(false);assert.equal(r.ready,false);assert.equal(r.credits,1);await assert.rejects(reward(true),/reward_not_ready/);
 await q("update loox_return_rewards set next_claim_at=now()-interval '1 hour'");await assert.rejects(reward(true),/reward_balance_cap/);
 await q('update loox_wallets set balance=0 where user_id=$1',[u]);const results=await Promise.allSettled([reward(true),reward(true)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(Number((await one('select balance from loox_wallets where user_id=$1',[u])).balance),1);assert.equal(Number((await one("select count(*) as n from loox_credits where reason='Return reward'")).n),1);
 await q('delete from auth.users where id=$1',[u]);await q('insert into auth.users values($1)',[u]);await q("select loox_account($1,'Test',$2,'2026-11')",[u,fp]);assert.equal(Number((await one('select balance from loox_wallets where user_id=$1',[u])).balance),0);await assert.rejects(reward(true),/reward_not_ready/);
 await q('update loox_wallets set balance=1000 where user_id=$1',[u]);await assert.rejects(q("select loox_reserve($1,$2,'test','video_kling_40_5',25,99999999)",[u,randomUUID()]),/plan_required/);
 await q("select loox_billing($1,'creator','sub-created','active',0,'USD','sub-creator',now(),null)",[u]);assert.equal((await one('select loox_member_tier($1) as t',[u])).t,'creator');await assert.rejects(q("select loox_reserve($1,$2,'test','video_kling_40_5',25,99999999)",[u,randomUUID()]),/plan_required/);
 const job=(await one("select loox_reserve($1,$2,'test','video_grok_video_5',25,99999999) as j",[u,randomUUID()])).j;assert.ok(job.id);
 await q("update loox_subscriptions set plan='pro_yearly' where user_id=$1",[u]);const invoice=()=>q("select loox_billing($1,'pro_yearly','invoice-paid','paid',29000,'USD',null,now(),null)",[u]);const old=Number((await one('select balance from loox_wallets where user_id=$1',[u])).balance);await invoice();await invoice();assert.equal(Number((await one('select balance from loox_wallets where user_id=$1',[u])).balance),old+3000);assert.equal((await one('select loox_member_tier($1) as t',[u])).t,'pro');
 await q("select loox_billing($1,'pro_yearly','invoice-paid','refunded',29000,'USD',null,now(),null)",[u]);assert.equal(Number((await one('select balance from loox_wallets where user_id=$1',[u])).balance),old);
 await db.exec('set role authenticated');await assert.rejects(q('select loox_reward($1,$2,true)',[u,fp]),/permission denied/);await assert.rejects(q('select * from loox_return_rewards'),/permission denied/);await db.exec('reset role');assert.equal((await q('select id from loox_operations where cost*4000<max_millicents')).rows.length,0);
 }finally{await db.close();}
});
test('new video adapters pin paid settings; unverified preview fails closed',()=>{
 process.env.LOOX_IDENTITY_SECRET='test-signing';const b={prompt:' A small fox ',duration:5,ratio:'16:9'};
 assert.equal(videoModelInput({id:'minimax_h3'},b,'image','last').resolution,'768P');assert.equal(videoModelInput({id:'minimax_h3_lite'},b,'image','last').first_frame_image,'image');assert.equal(videoModelInput({id:'seedance_25'},b,'image','last').aspect_ratio,'adaptive');assert.equal(videoModelInput({id:'kling_40_flash'},b,'image').start_image,'image');assert.equal(videoCapabilities('kling_40_flash').endFrame,false);assert.deepEqual(videoCapabilities('veo_31_lite').ratios,['16:9','9:16']);assert.throws(()=>videoQuote({id:'test'},{...b,model:'flux3_video'},[]),/awaiting/);assert.equal(videoCatalog([]).find(m=>m.id==='flux3_video').available,false);
});
