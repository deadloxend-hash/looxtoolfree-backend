import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedOrigin,validateHost} from '../lib/request-policy.js';
test('trusted origins are exact HTTPS origins; lookalikes, paths, null, wildcards and credentials fail closed',()=>{
 const origin='https://deadloxend-hash.github.io';
 assert.equal(trustedOrigin(undefined),true);assert.equal(trustedOrigin(origin),true);
 for(const value of ['', 'null',origin+'.attacker.invalid',origin+'/looxtoolsfree','http://deadloxend-hash.github.io','https://user@deadloxend-hash.github.io'])assert.equal(trustedOrigin(value),false);
 for(const config of ['*',origin+'/','http://deadloxend-hash.github.io',origin+'/path'])assert.equal(trustedOrigin(origin,config),false);
});
test('production hosts use an explicit server-side allowlist and ignore forwarded-host',()=>{
 const env={VERCEL_ENV:'production',VERCEL_URL:'deployment-example.vercel.app',LOOX_ALLOWED_HOSTS:'api.example.com'};
 for(const host of ['looxtoolfree-backend.vercel.app','deployment-example.vercel.app','api.example.com'])assert.doesNotThrow(()=>validateHost({headers:{host}},env));
 for(const host of [undefined,'attacker.invalid','looxtoolfree-backend.vercel.app.attacker.invalid','api.example.com,attacker.invalid','api.example.com:443'])assert.throws(()=>validateHost({headers:{host,'x-forwarded-host':'api.example.com'}},env),e=>e.status===403);
 assert.doesNotThrow(()=>validateHost({headers:{host:'localhost:8765'}},{VERCEL_ENV:'development'}));
});
