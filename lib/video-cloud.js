// Replicate video generation. Keys, uploaded images, spend budgets and MP4 storage
// are handled server-side; never send the provider token or raw user image to clients.
import {env,need,Problem,rows,rpc,supa,uuid,mac} from './core.js';
import {prepareImage} from './jobs.js';

const catalog=[
 {id:'wan22_i2v_fast',name:'Wan 2.2 I2V Fast',model:'wan-video/wan-2.2-i2v-fast',image:true,seconds:[5],cost:5},
 {id:'wan22_5b_fast',name:'Wan 2.2 5B Fast',model:'wan-video/wan-2.2-5b-fast',image:false,seconds:[5],cost:3},
 {id:'wan22_t2v_fast',name:'Wan 2.2 T2V Fast',model:'wan-video/wan-2.2-t2v-fast',image:false,seconds:[5],cost:5},
 {id:'wan25_i2v',name:'Wan 2.5 I2V',model:'wan-video/wan-2.5-i2v',image:true,seconds:[5,10],cost:35},
 {id:'wan26_i2v_flash',name:'Wan 2.6 I2V Flash',model:'wan-video/wan2.6-i2v-flash',image:true,seconds:[5,10],cost:20},
 {id:'kling_30',name:'Kling 3.0 Standard',model:'kwaivgi/kling-v3-video',image:false,seconds:[5,10],cost:70,costs:{5:70,10:140},premium:true,provider:'Replicate'},
 {id:'seedance_20',name:'Seedance 2.0',model:'bytedance/seedance-2.0',image:false,seconds:[5,10],cost:80,costs:{5:80,10:160},premium:true,provider:'Replicate'},
 {id:'veo_31_fast',name:'Veo 3.1 Fast',model:'google/veo-3.1-fast',image:false,seconds:[4,6,8],cost:75,costs:{4:75,6:110,8:150},premium:true,provider:'Replicate'},
 {id:'runway_45',name:'Runway Gen-4.5',model:'runwayml/gen-4.5',image:false,seconds:[5,10],cost:75,costs:{5:75,10:150},premium:true,provider:'Replicate'},
 {id:'flux3_video',name:'FLUX 3 Video Draft HD',model:'flux-3-video',image:false,seconds:[5,10],cost:35,costs:{5:35,10:70},premium:true,provider:'BFL'}
].map(m=>({...m,operation:'video_'+m.id}));
const operationsFor=m=>m.costs?Object.keys(m.costs).map(duration=>m.operation+'_'+duration):[m.operation];
const operationFor=(m,duration)=>m.costs?m.operation+'_'+duration:m.operation;
export const cloudVideoOperations=catalog.flatMap(operationsFor);
const ratios=['16:9','9:16','1:1','4:3','3:4'];
const endpoint='https://api.replicate.com/v1/';
const isCloud=j=>cloudVideoOperations.includes(j.operation);
export function videoCatalog(ops=[]){
 return catalog.map(m=>{
  const durationCosts=Object.fromEntries(m.seconds.map(d=>[d,ops.find(o=>o.id===operationFor(m,d))?.cost??m.costs?.[d]??m.cost]));
  const configured=Boolean(m.provider==='BFL'?env.BFL_API_KEY:env.REPLICATE_API_TOKEN);
  const available=configured&&operationsFor(m).every(id=>ops.some(o=>o.id===id));
  return {id:m.id,name:m.name,provider:m.provider||'LOOX Cloud',imageRequired:m.image,
   durationOptions:m.seconds,operation:m.operation,creditCosts:durationCosts,cost:Math.min(...Object.values(durationCosts)),
   available,status:available?'available':'temporarily_unavailable',
   reason:available?'Available through LOOX Cloud.':'Cloud video generation requires an active server provider and database configuration.'};
 });
}
async function replicate(path,options={}){
 need(Boolean(env.REPLICATE_API_TOKEN),503,'Cloud video generation is not configured. No credits used.');
 return fetch(endpoint+path,{...options,headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN,...options.headers},
  redirect:'error',signal:AbortSignal.timeout(20000)});
}
async function sourceImage(b,id,user){
 const normalized=await prepareImage(b.image,4_000_000);
 const key=user+'/'+id+'-video-source.png';
 const binary=Buffer.from(normalized.uri.split(',')[1],'base64');
 await supa('/storage/v1/object/loox-results/'+key,{
  method:'POST',headers:{'Content-Type':'image/png','x-upsert':'true'},body:binary
 });
 const signed=await supa('/storage/v1/object/sign/loox-results/'+key,{
  method:'POST',body:JSON.stringify({expiresIn:3600})
 });
 need(typeof signed.signedURL==='string',503,'Unable to prepare the uploaded image.');
 return {url:env.SUPABASE_URL+'/storage/v1'+signed.signedURL,key};
}
function modelInput(model,b,url){
 const input={prompt:b.prompt.trim()};
 if(url&&(model.image||model.id==='wan22_5b_fast'||model.premium))input.image=url;
 if(model.id==='kling_30')return {...input,...(url?{start_image:url}:{}),mode:'standard',duration:b.duration,aspect_ratio:b.ratio,generate_audio:false};
 if(model.id==='seedance_20')return {...input,...(url?{image:url}:{}),duration:b.duration,resolution:'720p',aspect_ratio:b.ratio,generate_audio:true};
 if(model.id==='veo_31_fast')return {...input,...(url?{image:url}:{}),duration:b.duration,resolution:'720p',aspect_ratio:['16:9','9:16'].includes(b.ratio)?b.ratio:'16:9',generate_audio:false};
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
 need(uuid.test(b.requestId),400,'Invalid request ID.');
 need(typeof b.prompt==='string'&&b.prompt.trim().length>=1&&b.prompt.length<=800,400,'Enter a prompt up to 800 characters.');
 need(ratios.includes(b.ratio),400,'Unsupported aspect ratio.');
 need(m.seconds.includes(b.duration),400,'Choose a duration supported by the selected model.');
 need(!m.image||typeof b.image==='string',400,'Upload an image for this video model.');
 need(!b.image||typeof b.image==='string'&&b.image.startsWith('data:image/'),400,'Choose a valid image.');
 need(Boolean(m.provider==='BFL'?env.BFL_API_KEY:env.REPLICATE_API_TOKEN),503,'Cloud video provider is not configured. No credits used.');
 const budget=Number(env.LOOX_DAILY_BUDGET_MILLICENTS);
 need(Number.isSafeInteger(budget)&&budget>0,503,'Cloud video budget is not configured. No credits used.');
 const input={model:m.id,prompt:b.prompt.trim(),ratio:b.ratio,duration:b.duration,
  // Include a hash of the image rather than raw bytes in the job digest.
  image:b.image?mac(b.image):null};
 const job=await rpc('reserve',{p_user:u.id,p_digest:mac('video-cloud:'+JSON.stringify(input)),
  p_request:b.requestId,p_operation:operationFor(m,b.duration),p_daily:30,p_budget:budget});
 if(!job.fresh)return {id:job.id};
 let imagePath;
 try{
  let url;
  if(b.image){const source=await sourceImage(b,job.id,u.id);url=source.url;imagePath=source.key;}
  const body=m.provider==='BFL'
   ? {mode:url?'i2v':'t2v',prompt:b.prompt.trim(),aspect_ratio:b.ratio,duration:b.duration,resolution:'hd',draft:true,generate_audio:true,...(url?{keyframes:url}:{})}
   : {input:modelInput(m,b,url)};
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
  if(imagePath)await supa('/storage/v1/object/loox-results/'+imagePath,{method:'DELETE'}).catch(()=>{});
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
 const buf=Buffer.concat(chunks),path=j.user_id+'/'+j.id+'.mp4';
 // Verify the MP4 ftyp header before saving to the user's private results bucket.
 need(buf.length>12&&buf.toString('ascii',4,8)==='ftyp',422,'Invalid MP4 output.');
 await supa('/storage/v1/object/loox-results/'+path,{
  method:'POST',headers:{'Content-Type':'video/mp4','x-upsert':'true'},body:buf
 });
 return path;
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
      const path=await saveOutput(j,output);
      await rpc('finish',{p_id:j.id,p_path:path});
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
   const imagePath=j.user_id+'/'+j.id+'-video-source.png';
   await supa('/storage/v1/object/loox-results/'+imagePath,{method:'DELETE'}).catch(()=>{});
  }
 }
 let url=null;
 if(j.result_path){
  need(j.result_path.startsWith(u.id+'/')&&j.result_path.endsWith('.mp4'),403,'Unexpected video result.');
  const signed=await supa('/storage/v1/object/sign/loox-results/'+j.result_path,{
   method:'POST',body:JSON.stringify({expiresIn:300})
  });
  url=env.SUPABASE_URL+'/storage/v1'+signed.signedURL;
 }
 return {id:j.id,state:j.state,url,...(j.state==='failed'?{failure_code:j.failure_code||'processing_failed'}:{})};
}
