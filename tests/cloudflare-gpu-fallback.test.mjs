import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual jobs.js routing with a mocked database and GPU heartbeat,
// avoiding Cloudflare/network calls, secrets, or user accounts.
const source=fs.readFileSync(new URL('../lib/jobs.js',import.meta.url),'utf8')
 .replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');

const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function setup({online=false,cloudReady=true,reference=false,failCloud=false}={}){
 const actions=[];
 class Problem extends Error{constructor(status,message){super(message);this.status=status}}
 const need=(yes,status,message)=>{if(!yes)throw new Problem(status,message)};
 const heartbeat={modes:online?['generate','generate_reference']:[],last_seen:online?new Date().toISOString():'2020-01-01T00:00:00Z'};
 const context={
  Buffer,URL,Date,AbortSignal,Problem,need,
  env:{LOOX_DAILY_BUDGET_MILLICENTS:'100000',LOOX_WORKER_SECRET:'test'},
  uuid:{test:()=>true},mac:s=>'digest:'+s,aiReady:()=>true,
  cloudflareImageReady:()=>cloudReady,CLOUDFLARE_FLUX_DAILY_CAP:100,
  generateCloudflareFlux:async input=>{actions.push(['cloud',input]);if(failCloud)throw new Problem(429,'Provider limit');return Buffer.from('mock-png')},
  rows:async table=>{actions.push(['rows',table]);return table==='local_worker_health'?[heartbeat]:[]},
  rpc:async(name,body)=>{actions.push(['rpc',name,body]);if(name==='reserve')return {id:requestId,fresh:true};return true;},
  supa:async(path,options)=>{actions.push(['supa',path,options]);return {};},
  saveGeneratedMedia:async()=>({key:'users/example/generated.png',thumbnail_key:'thumb',type:'image/png',bytes:200,sha256:'abc'}),
  userKey:()=>'',workerInputURL:()=>'',putR2Object:async()=>{},
  sharp:()=>{throw Error('should not decode image for text-only routing')}
 };
 vm.runInNewContext(source+'\nglobalThis.testStart=start;',context);
 const b={operation:'generate',requestId,prompt:'Studio photograph of a flower',ratio:'1:1',...(reference?{reference_image:'data:image/png;base64,ZmFrZQ==',reference_strength:0.5,permission:true}:{})};
 return {start:()=>context.testStart({id:uid},b),actions,Problem};
}

test('offline FLUX text request uses Cloudflare, not local queue',async()=>{
 const {start,actions}=setup();
 assert.equal((await start()).id,requestId);
 assert.equal(actions.filter(x=>x[0]==='cloud').length,1);
 assert.equal(actions.some(x=>x[0]==='supa'&&x[1]==='/rest/v1/loox_local_queue'),false);
 assert.equal(actions.some(x=>x[0]==='rpc'&&x[1]==='rate'&&x[2].p_limit===100),true);
 assert.equal(actions.some(x=>x[0]==='rpc'&&x[1]==='finish_media'),true);
});
test('online GPU always uses local queue and never calls Cloudflare',async()=>{
 const {start,actions}=setup({online:true});
 assert.equal((await start()).id,requestId);
 assert.equal(actions.filter(x=>x[0]==='cloud').length,0);
 assert.equal(actions.some(x=>x[0]==='supa'&&x[1]==='/rest/v1/loox_local_queue'),true);
});
test('offline GPU without Cloudflare fails before credits reserved',async()=>{
 const {start,actions}=setup({cloudReady:false});
 await assert.rejects(start(),e=>e.status===503);
 assert.equal(actions.some(x=>x[0]==='rpc'&&x[1]==='reserve'),false);
});
test('Cloudflare failure releases reserved credits',async()=>{
 const {start,actions}=setup({failCloud:true});
 await assert.rejects(start(),e=>e.status===429);
 assert.equal(actions.some(x=>x[0]==='rpc'&&x[1]==='finish'),true);
 assert.equal(actions.some(x=>x[0]==='rpc'&&x[1]==='finish_media'),false);
});
