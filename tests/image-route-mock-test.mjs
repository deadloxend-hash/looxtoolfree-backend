import assert from 'node:assert/strict';
import {registry,buildInput,modelSettings,validateSchema} from '../src/ai/model-registry.js';
import {imageCatalog,cloudJob} from '../lib/image-cloud.js';
import {engineCatalog} from '../src/ai/engine.js';
const old=globalThis.fetch;let calls=0;
globalThis.fetch=async()=>{calls++;throw Error('Unapproved models must not contact a provider');};
try{
 delete process.env.LOOX_PAID_GENERATION_APPROVED;
 assert.equal(imageCatalog([]).filter(m=>m.available).length,0);
 for(const m of registry.filter(m=>!m.localOnly)){
  await assert.rejects(cloudJob({id:'fixture'},{model:m.id}),/not approved/);
  assert.equal(calls,0);
  assert.equal(engineCatalog(m.kind).find(x=>x.id===m.id)?.available??false,false);
  if(!m.model)continue;
  const body={prompt:'Mock schema only',ratio:m.capabilities.ratios[0],duration:m.durations[0],...(m.imageRequired?{image:'fixture'}:{})};
  const settings=modelSettings(m,body),input=buildInput(m,body,settings,m.imageRequired?'https://owned.example.test/frame.png':null);
  assert.ok(input.prompt);assert.ok(!JSON.stringify(input).includes('api_key'));
  // Mock schema validates wiring, never represents a live provider schema.
  validateSchema(input,{properties:Object.fromEntries(Object.entries(input).map(([k,v])=>[k,{type:typeof v==='number'?'integer':typeof v}]))});
 }
 console.log('PASS all paid routes fail closed and centralized adapter wiring validates against mocked schemas');
}finally{globalThis.fetch=old;}
