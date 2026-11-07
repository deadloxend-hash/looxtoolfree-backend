import test from 'node:test';
import assert from 'node:assert/strict';
import {templateAction} from '../lib/templates.js';
test('legacy public feed respects visibility, prompt privacy and video type',async()=>{
 const oldFetch=globalThis.fetch,oldEnv={...process.env};
 Object.assign(process.env,{SUPABASE_URL:'https://test.invalid',SUPABASE_PUBLISHABLE_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test',LOOX_IDENTITY_SECRET:'test'});
 const calls=[];globalThis.fetch=async input=>{const url=String(input);calls.push(url);let data;
 if(url.includes('/loox_template_submissions?')){assert.match(url,/visible=eq.true/);assert.match(url,/share_prompt/);data=[{id:'post',job_id:'job',user_id:'creator',prompt:'DO NOT SHARE',caption:'Public caption',share_prompt:false,status:'approved',submitted_at:'2026-11-06'}];}
 else if(url.includes('/loox_creator_profiles?'))data=[{user_id:'creator'}];
 else if(url.includes('/loox_profiles?'))data=[{user_id:'creator',name:'Creator'}];
 else if(url.includes('/loox_jobs?'))data=[{result_path:'creator/clip.mp4',operation:'video_wan25_i2v'}];
 else if(url.includes('/storage/'))data={signedURL:'/object/sign/loox-results/creator/clip.mp4?token=test'};
 else throw Error('Unexpected endpoint');return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});};
 try{let response;await templateAction({method:'GET',query:{}},{json:data=>{response=data;}},'public');assert.equal(response.items.length,1);assert.equal(response.items[0].prompt,null);assert.equal(response.items[0].caption,'Public caption');assert.equal(response.items[0].media_type,'video');assert.doesNotMatch(JSON.stringify(response),/DO NOT SHARE/);}
 finally{globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv);}
});
