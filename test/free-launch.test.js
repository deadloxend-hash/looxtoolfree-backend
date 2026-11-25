import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,launchCatalog} from '../src/config/launch.js';
import {paymentsEnabled,topupsEnabled} from '../src/config/billing.js';
import {providerRequest,paidGenerationApproved} from '../src/ai/replicate-provider.js';
import {start} from '../lib/jobs.js';
import {checkout,portal} from '../lib/billing.js';
import {rechargeCheckout} from '../src/billing/topups.js';
import handler from '../api/loox.js';
import {freeImageAvailability} from '../lib/launch-availability.js';
function env(t,values){for(const [key,value] of Object.entries(values)){const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}}
test('legacy approval flags cannot override launch locks or contact providers',async t=>{
 env(t,{PAYMENTS_ENABLED:'true',CREDIT_TOPUPS_ENABLED:'true',TOPUP_MARGIN_APPROVED:'true',LOOX_PAID_GENERATION_APPROVED:'true',LOOX_FLUX_PAID_FALLBACK:'true'});
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected external access');});
 assert.equal(paymentsEnabled(),false);assert.equal(topupsEnabled(),false);assert.equal(paidGenerationApproved(),false);
 for(const task of [()=>checkout({},'pro'),()=>rechargeCheckout({},'mini'),()=>portal({}),()=>start({},{operation:'generate_video'}),()=>providerRequest('models/google/nano-banana-2/predictions',{method:'POST'})])await assert.rejects(task(),e=>e.status===503);
 assert.equal(calls,0);
});
test('direct API checkout, recharge, portal and video attempts fail before authentication or side effects',async()=>{
 for(const action of ['checkout','recharge_checkout','portal','cloud_video_job','video_quote']){
  const req={method:'POST',query:{action},headers:{},body:{model:'veo_31_fast'}};
  let status,body;const res={setHeader(){},status(code){status=code;return this;},json(value){body=value;return this;},end(){}};
  await handler(req,res);assert.equal(status,503);assert.match(body.error,/coming soon/i);
 }
});
test('launch catalog keeps settings/prices and separates offline local models from premium locks',()=>{
 const c=launchCatalog({billing:true,checkoutPlans:['pro'],local:{available:true},models:[{id:'z_image_turbo',available:false,status:'coming_soon',cost:3},{id:'bfl_flux2_pro',available:true,cost:9,settings:{ratio:true}}],videoModels:[{id:'veo_31_fast',available:true,cost:20}]});
 assert.equal(c.models[0].status,'temporarily_offline');assert.equal(c.models[1].status,'coming_soon');assert.equal(c.models[1].available,false);assert.deepEqual(c.models[1].settings,{ratio:true});assert.equal(c.models[1].cost,9);assert.equal(c.videoModels[0].available,false);assert.equal(c.billing,false);assert.deepEqual(c.checkoutPlans,[]);assert.equal(launch.dailyImages,25);
});
test('free model health follows heartbeat, quota and maintenance',async t=>{
 env(t,{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'fixture',LOOX_IDENTITY_SECRET:'fixture',LOOX_WORKER_SECRET:'fixture',LOOX_DAILY_BUDGET_MILLICENTS:'100000',CLOUDFLARE_AI_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_AI_API_TOKEN:'fixture'});
 let used=100;t.mock.method(globalThis,'fetch',async()=>Response.json([{used,expires_at:new Date(Date.now()+60000).toISOString()}]));
 const live={last_seen:new Date().toISOString(),modes:['generate','generate_reference','generate_z_image','generate_flux2_klein_edit']};
 assert.equal((await freeImageAvailability(null)).available,false);used=99;assert.equal((await freeImageAvailability(null)).code,'A8');
 const online=await freeImageAvailability(live);assert.equal(online.code,'B8');assert.equal(online.referenceAvailable,true);assert.equal(online.zImage.available,true);assert.equal(online.klein.available,true);
 const offline=await freeImageAvailability({...live,last_seen:'2020-01-01'});assert.equal(offline.zImage.status,'temporarily_offline');assert.equal(offline.referenceAvailable,false);
 const paused=await freeImageAvailability(live,['generate','generate_z_image']);assert.equal(paused.available,false);assert.equal(paused.status,'maintenance');assert.equal(paused.zImage.available,false);
});
