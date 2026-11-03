import sharp from 'sharp';
import { env,need,Problem,rows,rpc,supa,uuid,mac,aiReady } from './core.js';

export const models={fill:'black-forest-labs/flux-fill-pro',uncrop:'black-forest-labs/flux-fill-pro',background:'bria/remove-background',upscale2:'google/upscaler',upscale4:'google/upscaler',enhance:'google/upscaler',erase:'bria/eraser',generate:'local-comfyui',generate_video:'local-comfyui-video',restore:'flux-kontext-apps/restore-image',retouch:'black-forest-labs/flux-kontext-pro',face_restore:'tencentarc/gfpgan:0fbacf7afc6c144e5be9767cff80f25aff23e52b0708f17e20f9879b2f21516c',face_swap:'easel/advanced-face-swap'};
const maxBytes=2_400_000;
export async function prepareImage(value,pixels) {
 const match=typeof value==='string' && value.length<=3_200_040 && /^data:image\/(jpeg|png|webp);base64,([a-z0-9+/]+=*)$/i.exec(value);
 need(match,400,'Choose a JPG, PNG or WebP under 2.4 MB.');
 const bytes=Buffer.from(match[2],'base64');
 need(bytes.length>0&&bytes.length<=maxBytes,413,'Image exceeds 2.4 MB.');
 try {
  const img=sharp(bytes,{limitInputPixels:pixels,failOn:'warning'});
  const meta=await img.metadata();
  need(meta.format===match[1] && (meta.pages||1)===1 && meta.width*meta.height<=pixels,400,'Unsupported image format, animation or dimensions.');
  // Decode and re-encode to reject corrupt streams, normalize EXIF orientation and strip metadata.
  const {data,info}=await img.rotate().png().toBuffer({resolveWithObject:true});
  need(data.length<=8_000_000,413,'Decoded image is too large.');
  return {uri:'data:image/png;base64,'+data.toString('base64'),width:info.width,height:info.height};
 } catch(e){if(e instanceof Problem)throw e;throw new Problem(400,'Image is damaged or exceeds the pixel limit.');}
}
export async function modelInput(b) {
 const op=b.operation;
 need(Object.hasOwn(models,op)&&uuid.test(b.requestId),400,'Unknown operation or request ID.');
 if(op==='generate'||op==='generate_video'){
  need(typeof b.prompt==='string'&&b.prompt.trim().length>0&&b.prompt.length<=1200,400,'Enter a prompt of up to 1,200 characters.');
  need(['1:1','16:9','9:16','4:3','3:4'].includes(b.ratio),400,'Unsupported aspect ratio.');
  if(op==='generate_video')need(b.prompt.trim().length<=800,400,'Video prompt must be under 800 characters.');
  need(b.seed==null || Number.isInteger(b.seed)&&b.seed>=0&&b.seed<=2147483647,400,'Invalid seed.');
  return {prompt:b.prompt.trim(),aspect_ratio:b.ratio,num_outputs:1,output_format:op==='generate_video'?'mp4':'png',...(b.seed==null?{}:{seed:b.seed})};
 }
 need(b.permission===true,400,'Confirm you own or have permission to use the image.');
 const maxPixels=op==='upscale4'?1_000_000:4_000_000;
 const img=await prepareImage(b.image,maxPixels);
 if(op==='face_swap'){
  need(b.consent===true,400,'Confirm that everyone whose face is used has consented.');
  const swap=await prepareImage(b.swap_image,4_000_000);
  return {target_image:img.uri,swap_image:swap.uri,hair_source:'target'};
 }
 if(['erase','fill','uncrop'].includes(op)){
  const mask=await prepareImage(b.mask,4_000_000);
  need(mask.width===img.width&&mask.height===img.height,400,'The mask must match the image size.');
  const stats=await sharp(Buffer.from(mask.uri.split(',')[1],'base64')).greyscale().stats();
  need(stats.channels[0].max>128,400,'Select the area to edit first.');
  if(op==='fill'||op==='uncrop'){
   need(typeof b.prompt==='string'&&b.prompt.trim().length>0&&b.prompt.length<=1200,400,'Describe the generated scene in up to 1,200 characters.');
   return {image:img.uri,mask:mask.uri,prompt:b.prompt.trim(),steps:30,output_format:'png'};
  }
  return {image:img.uri,mask:mask.uri,mask_type:'manual',preserve_alpha:true,content_moderation:true};
 }
 if(op==='background')return {image:img.uri,preserve_alpha:true};
 if(op==='upscale2'||op==='upscale4'||op==='enhance')return {image:img.uri,upscale_factor:op==='upscale4'?'x4':'x2',compression_quality:95};
 if(op==='restore')return {input_image:img.uri,output_format:'png'};
 if(op==='retouch')return {input_image:img.uri,prompt:'Subtly and naturally retouch this portrait: gently improve uneven skin texture and remove minor blemishes. Keep the person identity, facial proportions, facial features, hairstyle, expression, lighting, clothing and background unchanged. Preserve natural pores, realism and all distinctive marks. No beautification or face reshaping.',output_format:'png'};
 if(op==='face_restore')return {img:img.uri,scale:2,version:'v1.4'};
 need(false,400,'Unsupported processing operation.');
}

async function replicate(path,options={}) {
 return fetch('https://api.replicate.com/v1/'+path,{...options,headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000),redirect:'error'});
}
export async function start(u,b) {
 need(aiReady(),503,'Local GPU processing is not configured.');
 need(['generate','generate_video'].includes(b.operation),503,'This AI tool needs a compatible local ComfyUI workflow. Cloud fallback is disabled.');
 const input=await modelInput(b),operation=b.operation;
 // Every generation job is processed exclusively by the owner's ComfyUI GPU.
 const [heartbeat]=await rows('local_worker_health',{id:'eq.1',select:'modes,last_seen'});
 need(heartbeat&&Date.now()-Date.parse(heartbeat.last_seen)<90_000
   &&heartbeat.modes.includes(operation),503,'Your local GPU is offline or the workflow is not installed. No credits used.');
 const digest=mac('request:'+JSON.stringify([operation,input]));
 const job=await rpc('reserve',{p_user:u.id,p_digest:digest,p_request:b.requestId,p_operation:operation,p_daily:30,p_budget:Number(env.LOOX_DAILY_BUDGET_MILLICENTS)});
 if(job.fresh){
  try {
   // Keep future image/video prompt labels private to the authenticated account.
   await supa('/rest/v1/loox_jobs?'+new URLSearchParams({id:'eq.'+job.id,user_id:'eq.'+u.id}),{
    method:'PATCH',body:JSON.stringify({prompt:input.prompt})
   });
   await supa('/rest/v1/loox_local_queue',{
    method:'POST',body:JSON.stringify({job_id:job.id,user_id:u.id,operation,input})
   });
  } catch(e) {
   await rpc('finish',{p_id:job.id,p_path:null}).catch(()=>{});
   throw e;
  }
  return {id:job.id};
 }
 return {id:job.id};
}
/* Legacy cloud provider disabled for all local generation jobs.
  No prediction requests are ever made by the LOOX local generator.
 if(job.fresh){
  const webhookReady=Boolean(env.REPLICATE_WEBHOOK_SIGNING_SECRET && env.LOOX_BACKEND_URL);
  const url=webhookReady?new URL('/api/loox-prediction',env.LOOX_BACKEND_URL):null;
  if(url)url.search=new URLSearchParams({job:job.id,bind:mac('prediction:'+job.id)});
  // Only the owner backend can create CPU-validated private input files. Replicate gets expiring read URLs.
  try {
   for(const field of ['image','mask','input_image','swap_image','target_image','img']){
    if(!input[field])continue;
    const path=u.id+'/'+job.id+'-'+field+'.png';
    const data=Buffer.from(input[field].split(',')[1],'base64');
    await supa('/storage/v1/object/loox-results/'+path,{method:'POST',headers:{'Content-Type':'image/png'},body:data});
    const signed=await supa('/storage/v1/object/sign/loox-results/'+path,{method:'POST',body:JSON.stringify({expiresIn:1200})});
    input[field]=env.SUPABASE_URL+'/storage/v1'+signed.signedURL;
   }
  } catch {
   await rpc('finish',{p_id:job.id,p_path:null});
   return {id:job.id};
  }
  // Non-official models require a versioned /predictions request. Polling also
  // settles jobs when webhook delivery is not configured.
  const model=models[operation],versioned=model.includes(':');
  const payload={input,...(versioned?{version:model}:{})};
  if(webhookReady){
   payload.webhook=url.href;payload.webhook_events_filter=['completed'];
  }
  // An ambiguous timeout must never cause a second paid prediction for this request.
  let r;
  try {r=await replicate(versioned?'predictions':'models/'+model+'/predictions',{method:'POST',headers:{'Cancel-After':'10m'},body:JSON.stringify(payload)});}catch{return {id:job.id};}
  if(r.ok){const p=await r.json();await bind(job.id,p.id);}
  else if(r.status>=400 && r.status<500){
   // Log only safe diagnostic metadata. Never log prompts, input URLs, token or image data.
   let reason='unknown';try{const err=await r.json();reason=String(err?.detail?.[0]?.type||err?.title||err?.error||'unknown').slice(0,80)}catch{}
   console.error('LOOX Replicate rejected prediction',{operation,status:r.status,reason});
   await rpc('finish',{p_id:job.id,p_path:null});
   const failureCode=r.status===402?'provider_billing':r.status===401||r.status===403?'provider_auth':r.status===429?'provider_limit':'provider_rejected';
   await supa('/rest/v1/loox_jobs?id=eq.'+job.id,{method:'PATCH',body:JSON.stringify({failure_code:failureCode})});
  }
 }
 return {id:job.id};
}
*/
export async function bind(id,prediction){
 need(/^[a-z0-9]{1,100}$/i.test(prediction),400,'Invalid prediction.');
 await supa('/rest/v1/loox_jobs?'+new URLSearchParams({id:'eq.'+id,state:'eq.reserved',prediction:'is.null'}),{method:'PATCH',body:JSON.stringify({prediction,state:'processing'})});
}
async function readOutput(url) {
 const target=new URL(url);
 need(target.protocol==='https:'&&!target.username&&!target.password&&!target.port&&(target.hostname==='replicate.delivery'||target.hostname.endsWith('.replicate.delivery')),502,'Unexpected output host.');
 const r=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(25000)});
 need(r.ok,503,'Your result is being saved.');const chunks=[];let bytes=0;
 for await(const chunk of r.body){bytes+=chunk.length;need(bytes<=32_000_000,422,'Output is too large.');chunks.push(chunk);}
 let png;
 try {png=await sharp(Buffer.concat(chunks),{limitInputPixels:20_000_000,failOn:'warning'}).png().toBuffer();}catch{throw new Problem(422,'Invalid model output.');}
 need(png.length<=32_000_000,422,'Output exceeds storage limit.');return png;
}
export async function reconcile(j) {
 if(!['processing','reserved'].includes(j.state))return;
 const age=Date.now()-Date.parse(j.created_at);
 if(!j.prediction){if(age>25*60000)await rpc('finish',{p_id:j.id,p_path:null});return;}
 const r=await replicate('predictions/'+encodeURIComponent(j.prediction));
 if(!r.ok){if(r.status===404 && age>25*60000)await rpc('finish',{p_id:j.id,p_path:null});else throw new Problem(503,'Prediction status is temporarily unavailable.');return;}
 const p=await r.json();
 if(p.status==='succeeded'){
  const path=j.user_id+'/'+j.id+'.png';
  try {
   const output=Array.isArray(p.output)?p.output[0]:p.output;
   need(typeof output==='string',422,'Missing model output.');
   const data=await readOutput(output);
   await supa('/storage/v1/object/loox-results/'+path,{method:'POST',headers:{'Content-Type':'image/png','x-upsert':'true'},body:data});
   await rpc('finish',{p_id:j.id,p_path:path});
  }catch(e){if(e.status!==422 && age<55*60000)throw e;await rpc('finish',{p_id:j.id,p_path:null});}
 }else if(['failed','canceled','aborted'].includes(p.status))await rpc('finish',{p_id:j.id,p_path:null});
}
export async function status(u,id){
 need(uuid.test(id),400,'Invalid job ID.');
 const get=async()=>(await rows('jobs',{id:'eq.'+id,user_id:'eq.'+u.id,select:'*'}))[0];
 let job=await get();need(job,404,'Job not found.');
 if(['reserved','processing'].includes(job.state)){
  await rpc('local_expire',{});
  job=await get();
}
 let url=null;
 if(job.result_path){
  const s=await supa('/storage/v1/object/sign/loox-results/'+job.result_path,{method:'POST',body:JSON.stringify({expiresIn:300})});
  url=env.SUPABASE_URL+'/storage/v1'+s.signedURL;
 }
 return {id:job.id,state:job.state,url,...(job.state==='failed'?{failure_code:job.failure_code||'processing_failed'}:{})};
}
