// Replicate video generation. Keys, uploaded images, spend budgets and MP4 storage
// are handled server-side; never send the provider token or raw user image to clients.
import {env,need,Problem,rows,rpc,supa,uuid,mac,equal} from './core.js';
import {prepareImage} from './jobs.js';
import {mediaURL,saveGeneratedMedia,userKey,workerInputURL} from './media-store.js';
import {deleteR2Object,putR2Object} from './r2.js';

const catalog=[
 {id:'wan22_i2v_fast',name:'Wan 2.2 I2V Fast',model:'wan-video/wan-2.2-i2v-fast',image:true,seconds:[5],cost:5},
 {id:'wan22_5b_fast',name:'Wan 2.2 5B Fast',model:'wan-video/wan-2.2-5b-fast',image:false,seconds:[5],cost:3},
 {id:'wan22_t2v_fast',name:'Wan 2.2 T2V Fast',model:'wan-video/wan-2.2-t2v-fast',image:false,seconds:[5],cost:5},
 {id:'wan25_i2v',name:'Wan 2.5 I2V',model:'wan-video/wan-2.5-i2v',image:true,seconds:[5,10],cost:35,costs:{5:35,10:70}},
 {id:'wan26_i2v_flash',name:'Wan 2.6 I2V Flash',model:'wan-video/wan2.6-i2v-flash',image:true,seconds:[5,10],cost:20,costs:{5:20,10:40}},
 {id:'kling_30',name:'Kling 3.0 Standard',model:'kwaivgi/kling-v3-video',image:false,seconds:[5,10],cost:70,costs:{5:70,10:140},premium:true,provider:'Replicate'},
 {id:'seedance_20',name:'Seedance 2.0',model:'bytedance/seedance-2.0',image:false,seconds:[5,10],cost:80,costs:{5:80,10:160},premium:true,provider:'Replicate'},
 {id:'veo_31_fast',name:'Veo 3.1 Fast',model:'google/veo-3.1-fast',image:false,seconds:[4,6,8],cost:75,costs:{4:75,6:110,8:150},premium:true,provider:'Replicate'},
 {id:'runway_45',name:'Runway Gen-4.5',model:'runwayml/gen-4.5',image:false,seconds:[5,10],cost:75,costs:{5:75,10:150},premium:true,provider:'Replicate'},
 {id:'flux3_video',name:'FLUX 3 Video Draft HD',model:'flux-3-video',image:false,seconds:[5,10],cost:35,costs:{5:35,10:70},premium:true,provider:'BFL'}
,
 {"id": "kling_40", "name": "Kling 4.0", "model": "kwaivgi/kling-v4.0", "image": false, "seconds": [5, 10], "cost": 24, "costs": {"5": 24, "10": 48}, "minimumPlan": "pro", "provider": "Replicate"},
 {"id": "kling_40_flash", "name": "Kling 4.0 Flash", "model": "kwaivgi/kling-v4-flash", "image": false, "seconds": [5, 10], "cost": 15, "costs": {"5": 15, "10": 30}, "minimumPlan": "creator", "provider": "Replicate"},
 {"id": "seedance_25", "name": "Seedance 2.5", "model": "bytedance/seedance-2.5", "image": false, "seconds": [5, 10], "cost": 35, "costs": {"5": 35, "10": 70}, "minimumPlan": "pro", "provider": "Replicate"},
 {"id": "seedance_20_fast", "name": "Seedance 2.0 Fast", "model": "bytedance/seedance-2.0-fast", "image": false, "seconds": [5, 10], "cost": 38, "costs": {"5": 38, "10": 76}, "minimumPlan": "creator", "provider": "Replicate"},
 {"id": "grok_video", "name": "Grok Imagine Video", "model": "xai/grok-imagine-video", "image": false, "seconds": [5, 10], "cost": 11, "costs": {"5": 11, "10": 22}, "minimumPlan": "creator", "provider": "Replicate"},
 {"id": "veo_31", "name": "Veo 3.1", "model": "google/veo-3.1", "image": false, "seconds": [4, 6, 8], "cost": 48, "costs": {"4": 48, "6": 72, "8": 96}, "minimumPlan": "pro", "provider": "Replicate"},
 {"id": "veo_31_lite", "name": "Veo 3.1 Lite", "model": "google/veo-3.1-lite", "image": false, "seconds": [4, 6, 8], "cost": 6, "costs": {"4": 6, "6": 9, "8": 12}, "minimumPlan": "creator", "provider": "Replicate"},
 {"id": "minimax_h3", "name": "MiniMax H3", "model": "minimax/h3", "image": false, "seconds": [5, 10], "cost": 12, "costs": {"5": 12, "10": 24}, "minimumPlan": "creator", "provider": "Replicate"},
 {"id": "minimax_h3_lite", "name": "MiniMax H3 Lite", "model": "minimax/h3-lite", "image": false, "seconds": [5, 10], "cost": 6, "costs": {"5": 6, "10": 12}, "minimumPlan": "creator", "provider": "Replicate"},
 {"id": "wan_30", "name": "Wan 3.0", "model": "alibaba/wan-3", "image": false, "seconds": [5, 10], "cost": 15, "costs": {"5": 15, "10": 30}, "minimumPlan": "creator", "provider": "Replicate"},
 {"id": "luma_ray2", "name": "Luma Ray 2", "model": "luma/ray-2-720p", "image": false, "seconds": [5, 9], "cost": 27, "costs": {"5": 27, "9": 49}, "minimumPlan": "creator", "provider": "Replicate"}
].map(m=>({...m,operation:'video_'+m.id}));
const operationsFor=m=>m.costs?Object.keys(m.costs).map(duration=>m.operation+'_'+duration):[m.operation];
const operationFor=(m,duration)=>m.costs?m.operation+'_'+duration:m.operation;
export const cloudVideoOperations=[...new Set(catalog.flatMap(m=>[m.operation,...operationsFor(m)]))];
const ratios=['16:9','9:16','1:1','4:3','3:4'];
const endpoint='https://api.replicate.com/v1/';
const isCloud=j=>cloudVideoOperations.includes(j.operation);
export function videoCapabilities(id){return {imageReference:id!=='wan22_t2v_fast',endFrame:['kling_30','kling_40','veo_31_fast','veo_31','veo_31_lite','seedance_25','seedance_20_fast','minimax_h3','minimax_h3_lite','luma_ray2'].includes(id),videoReference:false,ratios:id.startsWith('veo_')?['16:9','9:16']:id.startsWith('kling_')?['16:9','9:16','1:1']:ratios,resolution:id.startsWith('minimax_')?'768P':'720p'};}
const verified=m=>m.id!=='flux3_video';

export function videoCatalog(ops=[]){
 return catalog.map(m=>{
  const durationCosts=Object.fromEntries(m.seconds.map(d=>[d,ops.find(o=>o.id===operationFor(m,d))?.cost??m.costs?.[d]??m.cost]));
  const configured=Boolean(m.provider==='BFL'?env.BFL_API_KEY:env.REPLICATE_API_TOKEN);
  const available=verified(m)&&configured&&operationsFor(m).every(id=>ops.some(o=>o.id===id));
  return {minimumPlan:m.minimumPlan||(m.premium?'pro':'creator'),capabilities:videoCapabilities(m.id),id:m.id,name:m.name,provider:m.provider||'LOOX Cloud',imageRequired:m.image,
   durationOptions:m.seconds,operation:m.operation,creditCosts:durationCosts,cost:Math.min(...Object.values(durationCosts)),
   available,status:available?'available':'temporarily_unavailable',
   reason:!verified(m)?'Early access: provider access and pricing must be confirmed before generation.':available?'Available through LOOX Cloud.':'Cloud video generation requires an active server provider and database configuration.'};
 }).concat([{id:'sora_2',name:'Sora 2 · unavailable',provider:'Replicate',available:false,status:'temporarily_unavailable',minimumPlan:'pro',imageRequired:false,durationOptions:[],creditCosts:{},cost:null,capabilities:{imageReference:false,endFrame:false,videoReference:false,ratios:[],resolution:'—'},reason:'Provider discontinuation notice: Sora 2 API is no longer available. No generation or charges.'}]);
}

// Quotes bind account, settings and the database charge. Client prices are ignored.
export function videoQuote(user,b,operations,now=Date.now()){
 const local=b.model==='wan21',m=catalog.find(m=>m.id===b.model);
 need(local||m,400,'Choose a supported video model.');
 if(m)need(verified(m),503,'This model is awaiting verified provider pricing and access. No credits used.');
 need((local?[2]:m.seconds).includes(Number(b.duration)),400,'Choose a supported duration.');
 need(ratios.includes(b.ratio),400,'Unsupported aspect ratio.');
 if(m)need(videoCapabilities(m.id).ratios.includes(b.ratio),400,'Choose an aspect ratio supported by this model.');
 if(m?.id==='kling_30')need(['16:9','9:16','1:1'].includes(b.ratio),400,'Kling supports 16:9, 9:16 or 1:1.');
 need(b.resolution==null||b.resolution===(m?videoCapabilities(m.id).resolution:'720p'),400,'This adapter uses its configured output size.');
 need(b.audio==null,400,'Audio selection is not available for this adapter.');
 const operation=local?'generate_video':operationFor(m,Number(b.duration)),op=operations.find(o=>o.id===operation);
 need(op&&Number.isSafeInteger(Number(op.cost))&&Number(op.cost)>0,503,'This video price is not configured. No credits used.');
 const expires=Math.floor(now/1000)+300,payload=[user.id,b.model,Number(b.duration),b.ratio,operation,Number(op.cost),expires].join('|');
 return {model:b.model,duration:Number(b.duration),ratio:b.ratio,operation,credits:Number(op.cost),expires_at:new Date(expires*1000).toISOString(),token:expires+'.'+mac('video-quote:'+payload),pricing_basis:'configured_backend_operation'};
}
export function validateVideoQuote(user,b,operations,now=Date.now()){
 const fresh=videoQuote(user,b,operations,now);
 if(b.quoteToken==null)return fresh; // Legacy clients cannot override database pricing.
 need(typeof b.quoteToken==='string'&&/^\d{10}\.[a-f0-9]{64}$/.test(b.quoteToken),409,'Video quote is invalid. Refresh the price.');
 const [expiry,signature]=b.quoteToken.split('.'),expires=Number(expiry);
 need(expires>=Math.floor(now/1000)&&expires<=Math.floor(now/1000)+310,409,'Video quote expired. Refresh the price.');
 const payload=[user.id,b.model,Number(b.duration),b.ratio,fresh.operation,fresh.credits,expires].join('|');
 need(equal(signature,mac('video-quote:'+payload)),409,'Video settings or price changed. Refresh the quote before generating.');return fresh;
}

async function replicate(path,options={}){
 need(Boolean(env.REPLICATE_API_TOKEN),503,'Cloud video generation is not configured. No credits used.');
 return fetch(endpoint+path,{...options,headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN,...options.headers},
  redirect:'error',signal:AbortSignal.timeout(20000)});
}
async function sourceImage(normalized,id,user,suffix='-video-source'){
 const key=userKey(user,'inputs',id,'image/png',suffix);
 const binary=Buffer.from(normalized.uri.split(',')[1],'base64');
 await putR2Object(key,binary,'image/png');
 return {url:workerInputURL(key,3600),key};
}
export function videoModelInput(model,b,url,endUrl){
 const input={prompt:b.prompt.trim()};
 const id=model.id;
 if(['kling_40','kling_40_flash'].includes(id))return {...input,duration:b.duration,resolution:'720p',aspect_ratio:b.ratio,...(url?{start_image:url}:{}),...(endUrl?{end_image:endUrl}:{})};
 if(['seedance_25','seedance_20_fast'].includes(id))return {...input,duration:b.duration,resolution:'720p',aspect_ratio:url?'adaptive':b.ratio,generate_audio:true,...(url?{image:url}:{}),...(endUrl?{last_frame_image:endUrl}:{})};
 if(['veo_31','veo_31_lite'].includes(id))return {...input,duration:b.duration,resolution:'720p',aspect_ratio:b.ratio,...(id==='veo_31'?{generate_audio:true}:{}),...(url?{image:url}:{}),...(endUrl?{last_frame:endUrl}:{})};
 if(id==='grok_video')return {...input,duration:b.duration,resolution:'720p',aspect_ratio:b.ratio,...(url?{image:url}:{})};
 if(id.startsWith('minimax_h3'))return {...input,duration:b.duration,resolution:'768P',ratio:b.ratio,...(url?{first_frame_image:url}:{}),...(endUrl?{last_frame_image:endUrl}:{})};
 if(id==='wan_30')return {...input,duration:b.duration,resolution:'720p',aspect_ratio:b.ratio,enable_prompt_expansion:false,...(url?{image:url}:{})};
 if(id==='luma_ray2')return {...input,duration:b.duration,aspect_ratio:b.ratio,...(url?{start_image:url}:{}),...(endUrl?{end_image:endUrl}:{})};

 if(url&&(model.image||model.id==='wan22_5b_fast'||['seedance_20','veo_31_fast','runway_45'].includes(model.id)))input.image=url;
 if(model.id==='kling_30')return {...input,...(url?{start_image:url}:{}),...(endUrl?{end_image:endUrl}:{}),mode:'standard',duration:b.duration,aspect_ratio:b.ratio,generate_audio:false};
 if(model.id==='seedance_20')return {...input,...(url?{image:url}:{}),duration:b.duration,resolution:'720p',aspect_ratio:b.ratio,generate_audio:true};
 if(model.id==='veo_31_fast')return {...input,...(url?{image:url}:{}),...(endUrl?{last_frame:endUrl}:{}),duration:b.duration,resolution:'720p',aspect_ratio:b.ratio,generate_audio:false};
 if(model.id==='runway_45')return {...input,...(url?{image:url}:{}),duration:b.duration,aspect_ratio:b.ratio};
 if(model.id==='wan25_i2v')return {...input,resolution:'720p',duration:b.duration,enable_prompt_expansion:true};
 if(model.id==='wan26_i2v_flash')return {...input,resolution:'720p',duration:b.duration,audio_enabled:false,enable_prompt_expansion:true,multi_shots:false};
 if(model.id==='wan22_5b_fast')return {...input,num_frames:81,resolution:'720p',aspect_ratio:b.ratio,frames_per_second:16,go_fast:true};
 if(model.id==='wan22_t2v_fast')return {...input,num_frames:81,resolution:'720p',aspect_ratio:b.ratio,frames_per_second:16,go_fast:true};
 // Wan 2.2 I2V Fast uses the input image's framing, not aspect_ratio.
 return {...input,num_frames:81,resolution:'720p',frames_per_second:16,go_fast:true};
}
export async function cloudVideoJob(u,b){
 const m=catalog.find(x=>x.id===b.model);
 need(m,400,'Choose a supported video model.');
 need(verified(m),503,'This model is awaiting verified provider pricing and access. No credits used.');
 need(uuid.test(b.requestId),400,'Invalid request ID.');
 need(typeof b.prompt==='string'&&b.prompt.trim().length>=1&&b.prompt.length<=800,400,'Enter a prompt up to 800 characters.');
 need(ratios.includes(b.ratio),400,'Unsupported aspect ratio.');
 need(videoCapabilities(m.id).ratios.includes(b.ratio),400,'Choose an aspect ratio supported by this model.');
 if(m.id==='kling_30')need(['16:9','9:16','1:1'].includes(b.ratio),400,'Kling supports 16:9, 9:16 or 1:1.');
 need(m.seconds.includes(b.duration),400,'Choose a duration supported by the selected model.');
 need(!m.image||typeof b.image==='string',400,'Upload an image for this video model.');
 need(!b.image||typeof b.image==='string'&&b.image.startsWith('data:image/'),400,'Choose a valid image.');
 need(!b.image||videoCapabilities(m.id).imageReference,400,'This model does not accept image references.');
 need(!b.end_image||videoCapabilities(m.id).endFrame,400,'This model does not support an end frame.');
 need(!b.end_image||b.image,400,'An end frame requires a start frame.');
 if(b.end_image&&m.id.startsWith('veo_'))need(b.duration===8,400,'Veo end-frame transitions require 8 seconds.');
 need(b.video_reference==null,400,'Video references are not supported by the configured adapters.');
 const startFrame=b.image?await prepareImage(b.image,4_000_000):null,endFrame=b.end_image?await prepareImage(b.end_image,4_000_000):null;
 if(m.id==='kling_30')for(const frame of [startFrame,endFrame].filter(Boolean))need(Math.min(frame.width,frame.height)>=300,400,'Kling frames must be at least 300 pixels on each side.');
 need(Boolean(m.provider==='BFL'?env.BFL_API_KEY:env.REPLICATE_API_TOKEN),503,'Cloud video provider is not configured. No credits used.');
 validateVideoQuote(u,b,await rows('operations',{select:'id,cost'}));
 const budget=Number(env.LOOX_DAILY_BUDGET_MILLICENTS);
 need(Number.isSafeInteger(budget)&&budget>0,503,'Cloud video budget is not configured. No credits used.');
 const input={model:m.id,prompt:b.prompt.trim(),ratio:b.ratio,duration:b.duration,
  // Include a hash of the image rather than raw bytes in the job digest.
  image:b.image?mac(b.image):null,end_image:b.end_image?mac(b.end_image):null};
 const job=await rpc('reserve',{p_user:u.id,p_digest:mac('video-cloud:'+JSON.stringify(input)),
  p_request:b.requestId,p_operation:operationFor(m,b.duration),p_daily:30,p_budget:budget});
 if(!job.fresh)return {id:job.id};
 let imagePath,endPath;
 try{
  let url,endUrl;
  if(startFrame){const source=await sourceImage(startFrame,job.id,u.id);url=source.url;imagePath=source.key;}
  if(endFrame){const source=await sourceImage(endFrame,job.id,u.id,'-video-end');endUrl=source.url;endPath=source.key;}
  const body=m.provider==='BFL'
   ? {mode:url?'i2v':'t2v',prompt:b.prompt.trim(),aspect_ratio:b.ratio,duration:b.duration,resolution:'hd',draft:true,generate_audio:true,...(url?{keyframes:url}:{})}
   : {input:videoModelInput(m,b,url,endUrl)};
  const r=m.provider==='BFL'
   ? await fetch('https://api.bfl.ai/v1/flux-3-video',{method:'POST',
      headers:{'x-key':env.BFL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),
      redirect:'error',signal:AbortSignal.timeout(20000)})
   : await replicate('models/'+m.model+'/predictions',{method:'POST',
      headers:{'Content-Type':'application/json','Cancel-After':'30m'},body:JSON.stringify(body)});
  if(!r.ok){
   const msg=r.status===402?'Provider balance is insufficient. No LOOX credits used.':
    r.status===401||r.status===403?'Video provider authentication failed. No LOOX credits used.':
    r.status===429?'Video generation is rate limited. Try again later.':'Video provider rejected this request. No LOOX credits used.';
   throw new Problem(r.status===429?429:503,msg);
  }
  const prediction=await r.json();
  need(typeof prediction.id==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(prediction.id),503,'Provider did not confirm generation.');
  const providerId=m.provider==='BFL'?'bfl:'+prediction.id:prediction.id;
  await supa('/rest/v1/loox_jobs?'+new URLSearchParams({id:'eq.'+job.id,user_id:'eq.'+u.id}),{
   method:'PATCH',body:JSON.stringify({prompt:input.prompt,prediction:providerId,state:'processing'})
  });
  return {id:job.id};
 }catch(e){
  await rpc('finish',{p_id:job.id,p_path:null}).catch(()=>{});
  if(imagePath)await deleteR2Object(imagePath).catch(()=>{});
  if(endPath)await deleteR2Object(endPath).catch(()=>{});
  // Do not leak provider error bodies, credentials, or input URLs.
  if(e instanceof Problem)throw e;
  throw new Problem(503,'Unable to start video generation. Reserved LOOX credits were released.');
 }
}
async function saveOutput(j,url){
 const target=new URL(url);
 need(target.protocol==='https:'&&!target.username&&!target.password&&!target.port&&
  (target.hostname==='replicate.delivery'||target.hostname.endsWith('.replicate.delivery')||target.hostname==='bfl.ai'||target.hostname.endsWith('.bfl.ai')),502,'Unexpected video output host.');
 const r=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(45000)});
 need(r.ok,503,'Video output is not ready for storage.');
 const contentType=r.headers.get('content-type')||'';
 need(!contentType||contentType.includes('video')||contentType.includes('octet-stream'),422,'Invalid video output.');
 const max=90_000_000;
 const chunks=[];let size=0;
 for await(const chunk of r.body){size+=chunk.length;need(size<=max,422,'Video output exceeds storage limit.');chunks.push(chunk);}
 need(size>1000,422,'Video output is empty.');
 const buf=Buffer.concat(chunks);
 // Verify the MP4 ftyp header before saving to the user's private results bucket.
 need(buf.length>12&&buf.toString('ascii',4,8)==='ftyp',422,'Invalid MP4 output.');
 return saveGeneratedMedia({user:j.user_id,id:j.id,bytes:buf,type:'video/mp4'});
}
export async function cloudVideoStatus(u,id){
 need(uuid.test(id),400,'Invalid job ID.');
 const get=async()=>(await rows('jobs',{id:'eq.'+id,user_id:'eq.'+u.id,select:'*'}))[0];
 let j=await get();need(j&&isCloud(j),404,'Video generation not found.');
 if(['reserved','processing'].includes(j.state)){
  const age=Date.now()-Date.parse(j.created_at);
  if(!j.prediction){if(age>2*60_000)await rpc('finish',{p_id:j.id,p_path:null});}
  else{
   const isBfl=j.prediction.startsWith('bfl:');
   const r=isBfl
    ? await fetch('https://api.bfl.ai/v1/get_result?id='+encodeURIComponent(j.prediction.slice(4)),{
       headers:{'x-key':env.BFL_API_KEY},redirect:'error',signal:AbortSignal.timeout(20000)})
    : await replicate('predictions/'+encodeURIComponent(j.prediction));
   if(r.ok){
    const result=await r.json();
    if(result.status==='succeeded'||isBfl&&result.status==='Ready'){
     try{
      const output=isBfl?(result.result?.video||result.result?.sample||result.result?.url):Array.isArray(result.output)?result.output[0]:result.output;
      need(typeof output==='string',422,'Missing video output.');
      const media=await saveOutput(j,output);
      await rpc('finish_media',{p_id:j.id,p_provider:'r2',p_key:media.key,p_thumbnail:media.thumbnail_key,p_type:media.type,p_bytes:media.bytes,p_sha256:media.sha256});
     }catch(error){
      if(error instanceof Problem&&error.status===422||age>55*60_000)await rpc('finish',{p_id:j.id,p_path:null});
      else throw error;
     }
    }else if(['failed','canceled','aborted','Error','Request Moderated','Content Moderated','Task not found'].includes(result.status)){
     await rpc('finish',{p_id:j.id,p_path:null});
    }
   }else if(r.status===404&&age>25*60_000)await rpc('finish',{p_id:j.id,p_path:null});
   else if(!r.ok)throw new Problem(503,'Provider status temporarily unavailable.');
  }
  j=await get();
  if(['succeeded','failed'].includes(j.state)){
   const imagePath=userKey(j.user_id,'inputs',j.id,'image/png','-video-source');
   await deleteR2Object(imagePath).catch(()=>{});
   await deleteR2Object(userKey(j.user_id,'inputs',j.id,'image/png','-video-end')).catch(()=>{});
  }
 }
 const url=await mediaURL(j);
 return {id:j.id,state:j.state,url,...(j.state==='failed'?{failure_code:j.failure_code||'processing_failed'}:{})};
}
