import sharp from 'sharp';
import { env,need,Problem,rows,rpc,supa,uuid,mac,aiReady } from './core.js';

export const models={background:'bria/remove-background',upscale2:'google/upscaler',upscale4:'google/upscaler',erase:'bria/eraser',generate:'black-forest-labs/flux-schnell'};
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
 if(op==='generate'){
  need(typeof b.prompt==='string'&&b.prompt.trim().length>0&&b.prompt.length<=1200,400,'Enter a prompt of up to 1,200 characters.');
  need(['1:1','16:9','9:16','4:3','3:4'].includes(b.ratio),400,'Unsupported aspect ratio.');
  need(b.seed==null || Number.isInteger(b.seed)&&b.seed>=0&&b.seed<=2147483647,400,'Invalid seed.');
  return {prompt:b.prompt.trim(),aspect_ratio:b.ratio,num_outputs:1,output_format:'png',...(b.seed==null?{}:{seed:b.seed})};
 }
 need(b.permission===true,400,'Confirm permission to edit this image.');
 const img=await prepareImage(b.image,op==='upscale4'?1_000_000:4_000_000);
 if(op==='erase'){
  const mask=await prepareImage(b.mask,4_000_000);
  need(mask.width===img.width&&mask.height===img.height,400,'The mask must match the image size.');
  const stats=await sharp(Buffer.from(mask.uri.split(',')[1],'base64')).greyscale().stats();
  need(stats.channels[0].max>128,400,'Paint over an object first.');
  return {image:img.uri,mask:mask.uri};
 }
 if(op==='background')return {image:img.uri,preserve_alpha:true};
 return {image:img.uri,upscale_factor:op==='upscale2'?'x2':'x4',compression_quality:95};
}
async function replicate(path,options={}) {
 return fetch('https://api.replicate.com/v1/'+path,{...options,headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000),redirect:'error'});
}
export async function start(u,b) {
 need(aiReady(),503,'AI processing setup is pending.');
 const input=await modelInput(b),operation=b.operation;
 const digest=mac('request:'+JSON.stringify([operation,input]));
 const job=await rpc('reserve',{p_user:u.id,p_digest:digest,p_request:b.requestId,p_operation:operation,p_daily:Math.max(1,Math.min(100,Number(env.LOOX_USER_DAILY_JOBS)||20)),p_budget:Number(env.LOOX_DAILY_BUDGET_MILLICENTS)});
 if(job.fresh){
  const url=new URL('/api/loox-prediction',env.LOOX_BACKEND_URL);
  url.search=new URLSearchParams({job:job.id,bind:mac('prediction:'+job.id)});
  // Only the owner backend can create CPU-validated private input files. Replicate gets expiring read URLs.
  try {
   for(const field of ['image','mask']){
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
  // An ambiguous timeout must never trigger a second paid POST for this request.
  let r;
  try {r=await replicate('models/'+models[operation]+'/predictions',{method:'POST',headers:{'Cancel-After':'10m'},body:JSON.stringify({input,webhook:url.href,webhook_events_filter:['completed']})});}catch{return {id:job.id};}
  if(r.ok){const p=await r.json();await bind(job.id,p.id);}
  else if(r.status>=400 && r.status<500)await rpc('finish',{p_id:job.id,p_path:null});
 }
 return {id:job.id};
}
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
 if(['reserved','processing'].includes(job.state)){await reconcile(job);job=await get();}
 let url=null;
 if(job.result_path){
  const s=await supa('/storage/v1/object/sign/loox-results/'+job.result_path,{method:'POST',body:JSON.stringify({expiresIn:300})});
  url=env.SUPABASE_URL+'/storage/v1'+s.signedURL;
 }
 return {id:job.id,state:job.state,url};
}
