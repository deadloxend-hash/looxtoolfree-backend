import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupInputs} from '../lib/input-cleanup.js';
const user_id='11111111-1111-4111-8111-111111111111',one='22222222-2222-4222-8221-222222222222',two='33333333-3333-4333-8333-333333333333',jobs=[{id:one,user_id},{id:two,user_id}];
test('a failed input deletion keeps only that job pending and a later pass can finish cleanup',async()=>{
 const marked=[];const r=await cleanupInputs(jobs,{removeLegacy:async keys=>assert.equal(keys.length,10),removeObject:async key=>{assert.ok(key.startsWith('users/'+user_id+'/inputs/'));if(key.includes(one)&&key.endsWith('-reference_image.png'))throw Error('Transient storage failure');},markClean:async ids=>marked.push(...ids)});
 assert.deepEqual(r,{cleaned:1,pending:1});assert.deepEqual(marked,[two]);
 const retry=await cleanupInputs([jobs[0]],{removeLegacy:async()=>{},removeObject:async()=>{},markClean:async ids=>marked.push(...ids)});assert.equal(retry.pending,0);assert.deepEqual(marked,[two,one]);
});
test('legacy deletion failure never marks R2 input cleanup complete',async()=>{
 let marked=false;await assert.rejects(cleanupInputs(jobs,{removeLegacy:async()=>{throw Error('Storage unavailable');},removeObject:async()=>{},markClean:async()=>{marked=true;}}),/Storage unavailable/);assert.equal(marked,false);
});
