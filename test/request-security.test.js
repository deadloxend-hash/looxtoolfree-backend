import test from 'node:test';
import assert from 'node:assert/strict';
import {json,handler} from '../lib/core.js';
test('JSON size limit rejects oversized declared, encoded and parsed bodies',()=>{
 const h={'content-type':'application/json'};
 for(const req of [{headers:{...h,'content-length':'4500001'},body:{}},{headers:h,body:JSON.stringify({data:'x'.repeat(4500000)})},{headers:h,body:{data:'x'.repeat(4500000)}}])assert.throws(()=>json(req),e=>e.status===413);
 assert.deepEqual(json({headers:h,body:'{"prompt":"hello"}'}),{prompt:'hello'});
 assert.throws(()=>json({headers:h,body:'[]'}),e=>e.status===400);
});
test('CORS rejection preserves private response and transport headers',async()=>{
 const headers={};let status;const res={setHeader:(k,v)=>headers[k]=v,status(n){status=n;return this;},json(){},end(){}};
 await handler(()=>{throw Error('must not reach endpoint');})({headers:{origin:'https://attacker.invalid'},method:'GET'},res);
 assert.equal(status,403);assert.equal(headers['Strict-Transport-Security'],'max-age=31536000');assert.equal(headers['Cache-Control'],'private, no-store');assert.equal(headers['Access-Control-Allow-Origin'],undefined);
});
