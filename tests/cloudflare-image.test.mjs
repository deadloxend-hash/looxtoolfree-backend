import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {cloudflareImageReady,generateCloudflareFlux} from '../lib/cloudflare-image.js';

const account='a'.repeat(32);
const sample=await sharp({create:{width:512,height:512,channels:3,background:'#e2e6ee'}}).jpeg().toBuffer();
const restore=fn=>{const existing={account:process.env.CLOUDFLARE_AI_ACCOUNT_ID,token:process.env.CLOUDFLARE_AI_API_TOKEN,fetch:globalThis.fetch};return ()=>{if(existing.account===undefined)delete process.env.CLOUDFLARE_AI_ACCOUNT_ID;else process.env.CLOUDFLARE_AI_ACCOUNT_ID=existing.account;if(existing.token===undefined)delete process.env.CLOUDFLARE_AI_API_TOKEN;else process.env.CLOUDFLARE_AI_API_TOKEN=existing.token;globalThis.fetch=existing.fetch;}};

test('Cloudflare fallback calls exactly the FLUX.1 Schnell model, without unsupported dimensions',async()=>{
 const cleanup=restore();let sent;
 try{
  process.env.CLOUDFLARE_AI_ACCOUNT_ID=account;
  process.env.CLOUDFLARE_AI_API_TOKEN='TEST_ONLY';
  assert.equal(cloudflareImageReady(),true);
  globalThis.fetch=async(url,opts)=>{sent={url,opts};return {ok:true,json:async()=>({success:true,result:{image:sample.toString('base64')}})};};
  const png=await generateCloudflareFlux({prompt:'A photograph of a flower',aspect_ratio:'16:9',seed:42});
  const meta=await sharp(png).metadata();
  assert.equal(meta.format,'png');
  assert.ok(Math.abs(meta.width/meta.height-16/9)<0.02);
  assert.match(sent.url,/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell$/);
  const body=JSON.parse(sent.opts.body);
  assert.equal(body.steps,4);
  assert.equal(body.seed,42);
  assert.equal('width'in body,false);
  assert.equal('height'in body,false);
  assert.ok(sent.opts.headers.Authorization==='Bearer TEST_ONLY');
 }finally{cleanup();}
});
test('Cloudflare provider rate-limit returns a safe error',async()=>{
 const cleanup=restore();
 try{
  process.env.CLOUDFLARE_AI_ACCOUNT_ID=account;
  process.env.CLOUDFLARE_AI_API_TOKEN='TEST_ONLY';
  globalThis.fetch=async()=>({ok:false,status:429});
  await assert.rejects(generateCloudflareFlux({prompt:'flower',aspect_ratio:'1:1'}),e=>e.status===429&&e.message.includes('No credits used'));
 }finally{cleanup();}
});
