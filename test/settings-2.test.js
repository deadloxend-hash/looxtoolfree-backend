import {requireEnrolledMfa} from '../lib/core.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {accountOverview} from '../lib/account-overview.js';
import {revokeSessions} from '../lib/account-sessions.js';
const user={id:'00000000-0000-4000-8000-000000000001'};
test('optional history failure preserves authoritative wallet and owner filters',async()=>{
 const data=await accountOverview(user,{read:async(table,filters)=>{assert.equal(filters.user_id,'eq.'+user.id);if(table==='wallets')return [{balance:37,debt:0}];if(table==='credits')throw Error('unavailable');return [];}});
 assert.equal(data.wallet.balance,37);assert.deepEqual(data.unavailable,['credits']);
});
test('missing wallet fails without inventing a zero balance',async()=>{
 await assert.rejects(accountOverview(user,{read:async()=>[]}),e=>e.status===503);
});
test('session revocation verifies identity before calling the auth server',async()=>{
 let verified=false;
 const result=await revokeSessions(user,{password:'fixture',scope:'others'},{aal:'aal2'},'Bearer current',{verify:async(u,p)=>{assert.equal(u.id,user.id);assert.equal(p,'fixture');verified=true;},request:async(url,options)=>{assert.equal(verified,true);assert.ok(url.endsWith('?scope=others'));assert.equal(options.headers.Authorization,'Bearer current');return {ok:true};}});
 assert.equal(result.revoked,true);
});
test('bad password or arbitrary scope cannot revoke any sessions',async()=>{
 let calls=0;const deps={verify:async()=>{throw Error('Password verification failed');},request:async()=>{calls++;}};
 await assert.rejects(revokeSessions(user,{password:'wrong',scope:'global'},{},'Bearer current',deps),/Password verification failed/);
 await assert.rejects(revokeSessions(user,{password:'fixture',scope:'individual'},{},'Bearer current',deps),e=>e.status===400);
 assert.equal(calls,0);
});

test('enrolled MFA is enforced on the backend for password-only access tokens',()=>{
 assert.throws(()=>requireEnrolledMfa({factors:[{status:'verified'}]},{aal:'aal1'}),e=>e.status===403);
 assert.doesNotThrow(()=>requireEnrolledMfa({factors:[{status:'verified'}]},{aal:'aal2'}));
 assert.doesNotThrow(()=>requireEnrolledMfa({factors:[{status:'unverified'}]},{aal:'aal1'}));
});
