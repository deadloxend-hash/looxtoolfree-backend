import {engineStart,engineCatalog,engineStatus,engineRecord} from '../src/ai/engine.js';
import {providerRequest} from '../src/ai/replicate-provider.js';
import {registry} from '../src/ai/model-registry.js';
import {videoCapabilities,hasVerifiedAdapter} from './video-capabilities.js';
export {videoCapabilities} from './video-capabilities.js';
// Replicate video generation. Keys, uploaded images, spend budgets and MP4 storage
// are handled server-side; never send the provider token or raw user image to clients.
import {env,need,Problem,rows,rpc,supa,uuid,mac,equal} from './core.js';
import {prepareImage} from './jobs.js';
import {mediaURL,saveGeneratedMedia,userKey,workerInputURL} from './media-store.js';
import {deleteR2Object,putR2Object} from './r2.js';

const catalog=registry.filter(m=>m.kind==='video').map(m=>({...m,image:m.imageRequired,seconds:m.durations,cost:m.legacyCreditDefault,costs:m.creditsByDuration}));
const operationsFor=m=>m.costs?Object.keys(m.costs).map(duration=>m.operation+'_'+duration):[m.operation];
const operationFor=(m,duration)=>m.costs?m.operation+'_'+duration:m.operation;
export const cloudVideoOperations=[...new Set(catalog.flatMap(m=>[m.operation,...operationsFor(m)]))];
const ratios=['16:9','9:16','1:1','4:3','3:4'];
const endpoint='https://api.replicate.com/v1/';
const isCloud=j=>cloudVideoOperations.includes(j.operation);
const verified=m=>hasVerifiedAdapter(m.id);

export const videoCatalog=(ops=[],snapshot=null)=>engineCatalog('video',ops,snapshot);

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

const replicate=(path,options={})=>providerRequest(path,options);
async function sourceImage(normalized,id,user,suffix='-video-source'){
 const key=userKey(user,'inputs',id,'image/png',suffix);
 const binary=Buffer.from(normalized.uri.split(',')[1],'base64');
 await putR2Object(key,binary,'image/png');
 return {url:workerInputURL(key,3600),key};
}
export function videoModelInput(model,b,url,endUrl){
 const input={prompt:b.prompt.trim()};
 const id=model.id;
 if(id==='kling_40_flash')return {...input,duration:b.duration,aspect_ratio:b.ratio,...(url?{start_image:url}:{})};
 if(id==='kling_40')return {...input,duration:b.duration,resolution:'720p',aspect_ratio:b.ratio,...(url?{start_image:url}:{}),...(endUrl?{end_image:endUrl}:{})};
 if(['seedance_25','seedance_20_fast'].includes(id))return {...input,duration:b.duration,resolution:'720p',aspect_ratio:url?'adaptive':b.ratio,generate_audio:true,...(url?{image:url}:{}),...(endUrl?{last_frame_image:endUrl}:{})};
 if(['veo_31','veo_31_lite'].includes(id))return {...input,duration:b.duration,resolution:'720p',aspect_ratio:b.ratio,...(id==='veo_31'?{generate_audio:true}:{}),...(url?{image:url}:{}),...(endUrl?{last_frame:endUrl}:{})};
 if(id==='grok_video')return {...input,duration:b.duration,resolution:'720p',aspect_ratio:b.ratio,...(url?{image:url}:{})};
 if(id.startsWith('minimax_h3'))return {...input,duration:b.duration,resolution:'768P',ratio:url?'adaptive':b.ratio,...(url?{first_frame_image:url}:{}),...(endUrl?{last_frame_image:endUrl}:{})};
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
export const cloudVideoJob=(user,body)=>engineStart(user,body);
async function saveOutput(j,url){
 const target=new URL(url);
 need(target.protocol==='https:'&&!target.username&&!target.password&&!target.port&&
  (target.hostname==='replicate.delivery'||target.hostname.endsWith('.replicate.delivery')||target.hostname==='bfl.ai'||target.hostname.endsWith('.bfl.ai')),502,'Unexpected video output host.');
 const r=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(45000)});
 need(r.ok,503,'Video output is not ready for storage.');
 const contentType=r.headers.get('content-type')||'';
 need(!contentType||contentType.includes('video')||contentType.includes('octet-stream'),422,'Invalid video output.');
 const max=40_000_000;
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
 if(await engineRecord(id))return engineStatus(u,id);
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
      const finalized=await rpc('finish_media',{p_id:j.id,p_provider:'r2',p_key:media.key,p_thumbnail:media.thumbnail_key,p_type:media.type,p_bytes:media.bytes,p_sha256:media.sha256});
      need(finalized===true,422,'The output could not be finalized safely.');
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
