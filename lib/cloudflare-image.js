import sharp from 'sharp';
import {env,need,Problem} from './core.js';

// Cloudflare Workers AI is a shared, account-level allowance. Do not enable
// unlimited calls even if the account is on a Workers Paid plan.
export const CLOUDFLARE_FLUX_DAILY_CAP=100;
export const cloudflareImageReady=()=>/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_AI_ACCOUNT_ID||'')&&Boolean(env.CLOUDFLARE_AI_API_TOKEN?.trim());

const aspects={
 '1:1':{width:1024,height:1024,hint:'square'},
 '16:9':{width:1024,height:576,hint:'wide landscape, all important subjects centered'},
 '9:16':{width:576,height:1024,hint:'tall portrait, all important subjects centered'},
 '4:3':{width:1024,height:768,hint:'landscape, all important subjects centered'},
 '3:4':{width:768,height:1024,hint:'portrait, all important subjects centered'}
};

export async function generateCloudflareFlux({prompt,aspect_ratio,seed}){
 need(cloudflareImageReady(),503,'Cloudflare image fallback is not configured. No credits used.');
 const aspect=aspects[aspect_ratio];
 need(aspect&&typeof prompt==='string'&&prompt.length>0&&prompt.length<=1200,400,'Invalid image request.');
 // FLUX.1 Schnell on Workers AI only accepts prompt/steps/seed, not width/height.
 // Ask for safe framing, then crop locally to the requested ratio.
 const composed=aspect_ratio==='1:1'?prompt:prompt+'\nComposition: '+aspect.hint+' framing; allow space near the edges for cropping.';
 const payload={prompt:composed,steps:4,...(seed==null?{}:{seed})};
 const url='https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_AI_ACCOUNT_ID+'/ai/run/@cf/black-forest-labs/flux-1-schnell';
 let response;
 try{
  response=await fetch(url,{
   method:'POST',
   headers:{Authorization:'Bearer '+env.CLOUDFLARE_AI_API_TOKEN,'Content-Type':'application/json'},
   body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(60000)
  });
 }catch{
  throw new Problem(503,'Cloudflare image generation is temporarily unavailable. No credits used.');
 }
 if(!response.ok){
  throw new Problem(response.status===429?429:503,
   response.status===429?'Cloudflare image generation reached a provider limit. No credits used.':'Cloudflare image generation is unavailable. No credits used.');
 }
 let body;
 try{body=await response.json();}catch{throw new Problem(502,'Cloudflare returned an invalid image response. No credits used.');}
 const b64=body?.result?.image;
 need(body?.success===true&&typeof b64==='string'&&b64.length>100&&b64.length<22_000_000&&/^[a-z0-9+/]+={0,2}$/i.test(b64),502,
  'Cloudflare returned no usable image. No credits used.');
 const bytes=Buffer.from(b64,'base64');
 need(bytes.length>0&&bytes.length<=16_000_000,502,'Cloudflare image is too large. No credits used.');
 try{
  const img=sharp(bytes,{limitInputPixels:20_000_000,failOn:'warning'}).rotate();
  // Cloudflare's FLUX.1 Schnell does not expose an aspect-ratio parameter.
  // Downscale/crop without enlarging the provider's output.
  return await img.resize({width:aspect.width,height:aspect.height,fit:'cover',position:'attention',withoutEnlargement:true}).png().toBuffer();
 }catch{
  throw new Problem(502,'Cloudflare image could not be processed. No credits used.');
 }
}
