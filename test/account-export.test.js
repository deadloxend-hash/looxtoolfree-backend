import test from 'node:test';
import assert from 'node:assert/strict';
import {collectAccountRecords,verifyExportPassword,exportSections} from '../lib/account-export.js';
const A='00000000-0000-4000-8000-000000000001',T='00000000-0000-4000-8000-000000000002';
const user={id:A,email:'owner@example.com',email_confirmed_at:'2026-01-01'};
test('account export filters every section by verified owner and messages by owned thread; server page caps do not truncate',async()=>{
 const seen=[];
 const read=async(table,q)=>{seen.push([table,q]);assert.notEqual(q.select,'*');
  if(table==='chat_messages'){assert.equal(q.thread_id,'eq.'+T);assert.equal(q.user_id,undefined);return q.offset==='0'?[{id:'message',thread_id:T,content:'own conversation'}]:[];}
  if(table==='creator_follows')assert.ok(q.follower_id==='eq.'+A||q.creator_id==='eq.'+A);else assert.equal(q.user_id,'eq.'+A);
  if(table==='wallets')return [{balance:25,debt:0}];
  if(table==='chat_threads')return q.offset==='0'?[{id:T}]:[];
  if(table==='jobs')return q.offset==='0'?[{id:'job1'}]:q.offset==='1'?[{id:'job2'}]:[];
  return [];
 };
 const data=await collectAccountRecords(user,{read});
 assert.equal(data.account.id,A);assert.equal(data.records.jobs.length,2);assert.equal(data.records.chat_messages.length,1);
 assert.equal(Object.keys(data.records).length,Object.keys(exportSections).length+5);
 assert.ok(!JSON.stringify(data).includes('access_token'));
});
test('account export refuses oversized data instead of producing a partial download',async()=>{
 await assert.rejects(collectAccountRecords(user,{read:async(table,q)=>table==='jobs'&&q.offset==='0'?[{prompt:'x'.repeat(3500001)}]:[]}),e=>e.status===413);
});
test('export reauthentication fails closed, checks MFA, and revokes its isolated session',async()=>{
 const calls=[];
 const request=async(url,opts)=>{calls.push({url,opts});return url.includes('/token?')?{ok:true,json:async()=>({user:{id:A,factors:[{status:'verified'}]},access_token:'isolated-proof'})}:{ok:true};};
 await assert.rejects(verifyExportPassword(user,'not-stored',{aal:'aal1'},{request}),e=>e.status===403);
 assert.equal(calls.length,2);assert.ok(calls[1].url.endsWith('/logout?scope=local'));
 calls.length=0;await verifyExportPassword(user,'not-stored',{aal:'aal2'},{request});assert.equal(calls.length,2);
 await assert.rejects(verifyExportPassword(user,'wrong',{aal:'aal2'},{request:async()=>({ok:false})}),e=>e.status===403);
});
