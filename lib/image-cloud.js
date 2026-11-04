import sharp from 'sharp';
import {env,need,Problem,rows,rpc,supa,mac,uuid,authReady} from './core.js';

const catalog=[
 {id:'replicate',name:'FLUX 1.1 Pro',operation:'generate_replicate',cost:6,key:'REPLICATE_API_TOKEN'},
 {id:'google',name:'Gemini Flash Image',operation:'generate_google',cost:5,key:'GEMINI_API_KEY'},
 {id:'bfl',name:'FLUX 1.1 Pro',operation:'generate_bfl',cost:6,key:'BFL_API_KEY'},
 {id:'ideogram',name:'Ideogram 3.0',operation:'generate_ideogram',cost:6,key:'IDEOGRAM_API_KEY'},
 {id:'stability',name:'Stable Image Core',operation:'generate_stability',cost:5,key:'STABILITY_API_KEY'},
 {id:'byteplus',name:'Seedream',operation:'generate_byteplus',cost:6,key:'BYTEPLUS_API_KEY'},
 {id:'openai',name:'GPT Image',operation:'generate_openai',cost:6,key:'OPENAI_API_KEY'}
];
export const cloudOperations=catalog.map(m=>m.operation);
export function imageCatalog(){return catalog.map(m=>({id:m.id,name:m.name,operation:m.operation,cost:m.cost,available:Boolean(env[m.key]&&(m.id!=='byteplus'||env.BYTEPLUS_MODEL_ID))}));}
const ratios=['1:1','16:9','9:16','4:3','3:4'];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(url,options={}){
 const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!r.ok){
  // Never send provider body, prompt, token or private output URL to the client.
  throw new Problem(r.status===402?503:r.status===429?429:502,
   r.status===402?'This image model has no provider funds. No LOOX credits used.':
   r.status===401||r.status===403?'This image model is not configured correctly. No LOOX credits used.':
   r.status===429?'The image model is busy. Try again shortly.':'The image model could not complete the request.');
 }
 return r;
}
async function data(r){return r.json();}
async function imageURL(raw,hosts){
 need(typeof raw==='string',502,'Image model returned no result.');
 const u=new URL(raw);
 need(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&hosts.some(host=>u.hostname===host||u.hostname.endsWith('.'+host)),502,'Unexpected result host.');
 const r=await request(u.href);
 const bytes=Buffer.from(await r.arrayBuffer());
 need(bytes.length>0&&bytes.length<32_000_000,502,'Image model result is too large.');
 return bytes;
}
async function imageBytes(model,prompt,ratio){
 if(model.id==='openai'){
  const size=ratio==='1:1'?'1024x1024':ratio==='16:9'||ratio==='4:3'?'1536x1024':'1024x1536';
  const result=await data(await request('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:env.OPENAI_IMAGE_MODEL||'gpt-image-1.5',prompt,size,quality:'medium',output_format:'png',n:1})}));
  need(result.data?.[0]?.b64_json,502,'Image model returned no result.');
  return Buffer.from(result.data[0].b64_json,'base64');
 }
 if(model.id==='google'){
  const result=await data(await request('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(env.GOOGLE_IMAGE_MODEL||'gemini-2.5-flash-image')+':generateContent',{method:'POST',headers:{'x-goog-api-key':env.GEMINI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt+' (aspect ratio '+ratio+')'}]}],generationConfig:{responseModalities:['IMAGE']}})}));
  const part=result.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data);
  need(part,502,'Image model returned no result.');
  return Buffer.from(part.inlineData.data,'base64');
 }
 if(model.id==='stability'){
  const form=new FormData();form.set('prompt',prompt);form.set('aspect_ratio',ratio);form.set('output_format','png');
  const r=await request('https://api.stability.ai/v2beta/stable-image/generate/core',{method:'POST',headers:{Authorization:'Bearer '+env.STABILITY_API_KEY,Accept:'image/png'},body:form});
  return Buffer.from(await r.arrayBuffer());
 }
 if(model.id==='ideogram'){
  const form=new FormData();form.set('prompt',prompt);form.set('rendering_speed','TURBO');
  // The v3 endpoint accepts a fixed aspect-ratio enum; omit it for square.
  if(ratio!=='1:1')form.set('aspect_ratio','ASPECT_'+ratio.replace(':','_'));
  const result=await data(await request('https://api.ideogram.ai/v1/ideogram-v3/generate',{method:'POST',headers:{'Api-Key':env.IDEOGRAM_API_KEY},body:form}));
  need(result.data?.[0]?.is_image_safe!==false,422,'Image model declined the prompt.');
  return imageURL(result.data?.[0]?.url,['ideogram.ai']);
 }
 if(model.id==='byteplus'){
  const result=await data(await request('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations',{method:'POST',headers:{Authorization:'Bearer '+env.BYTEPLUS_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:env.BYTEPLUS_MODEL_ID,prompt,size:'2K',response_format:'b64_json',output_format:'png',watermark:false})}));
  need(result.data?.[0]?.b64_json,502,'Image model returned no result.');
  return Buffer.from(result.data[0].b64_json,'base64');
 }
 if(model.id==='replicate'){
  let result=await data(await request('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions',{method:'POST',headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN,'Content-Type':'application/json',Prefer:'wait=10','Cancel-After':'3m'},body:JSON.stringify({input:{prompt,aspect_ratio:ratio,output_format:'png'}})}));
  for(let i=0;i<8&&['starting','processing'].includes(result.status);i++){
   await delay(3000);
   result=await data(await request('https://api.replicate.com/v1/predictions/'+encodeURIComponent(result.id),{headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN}}));
  }
  need(result.status==='succeeded',502,'Image model did not finish in time.');
  return imageURL(Array.isArray(result.output)?result.output[0]:result.output,['replicate.delivery']);
 }
 if(model.id==='bfl'){
  let result=await data(await request('https://api.bfl.ai/v1/flux-pro-1.1',{method:'POST',headers:{'x-key':env.BFL_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({prompt,aspect_ratio:ratio,output_format:'png'})}));
  need(result.id,502,'Image model did not start.');
  for(let i=0;i<12;i++){
   await delay(2500);
   result=await data(await request('https://api.bfl.ai/v1/get_result?id='+encodeURIComponent(result.id),{headers:{'x-key':env.BFL_API_KEY}}));
   if(result.status==='Ready')return imageURL(result.result?.sample,['bfl.ai','blackforestlabs.ai']);
   if(['Error','Failed'].includes(result.status))break;
  }
  throw new Problem(502,'Image model did not finish in time.');
 }
 throw new Problem(400,'Unknown image model.');
}
export async function cloudJob(u,b){
 need(authReady(),503,'Account service is unavailable.');
 const model=catalog.find(m=>m.id===b.model);
 need(model,400,'Unknown image model.');
 need(env[model.key]&&(model.id!=='byteplus'||env.BYTEPLUS_MODEL_ID),503,'This premium image model is not active yet. No credits used.');
 need(uuid.test(b.requestId),400,'Invalid request ID.');
 need(typeof b.prompt==='string'&&b.prompt.trim()&&b.prompt.length<=1200,400,'Enter a prompt of up to 1,200 characters.');
 need(ratios.includes(b.ratio),400,'Unsupported aspect ratio.');
 const [subscriptions,paid]=await Promise.all([
  rows('subscriptions',{user_id:'eq.'+u.id,select:'status,ends_at'}),
  rows('payments',{user_id:'eq.'+u.id,plan:'eq.lifetime',status:'eq.paid',select:'reference',limit:'1'})
 ]);
 need(subscriptions.some(s=>s.status==='active'||s.status==='cancelled'&&Date.parse(s.ends_at)>Date.now())||paid.length,403,'Premium image models require a LOOX plan.');
 const input={model:model.id,prompt:b.prompt.trim(),ratio:b.ratio};
 const budget=Number(env.LOOX_DAILY_BUDGET_MILLICENTS);
 need(Number.isSafeInteger(budget)&&budget>0,503,'AI processing budget is not configured.');
 const job=await rpc('reserve',{p_user:u.id,p_digest:mac('cloud:'+JSON.stringify(input)),p_request:b.requestId,p_operation:model.operation,p_daily:30,p_budget:budget});
 if(!job.fresh)return {id:job.id};
 try{
  await supa('/rest/v1/loox_jobs?'+new URLSearchParams({id:'eq.'+job.id,user_id:'eq.'+u.id}),{method:'PATCH',body:JSON.stringify({prompt:input.prompt,state:'processing'})});
  const raw=await imageBytes(model,input.prompt,input.ratio);
  need(raw.length>0&&raw.length<32_000_000,502,'Image model returned an invalid result.');
  const png=await sharp(raw,{limitInputPixels:20_000_000,failOn:'warning'}).png().toBuffer();
  need(png.length<32_000_000,502,'Image is too large.');
  const path=u.id+'/'+job.id+'.png';
  await supa('/storage/v1/object/loox-results/'+path,{method:'POST',headers:{'Content-Type':'image/png'},body:png});
  await rpc('finish',{p_id:job.id,p_path:path});
  return {id:job.id};
 }catch(error){
  await rpc('finish',{p_id:job.id,p_path:null}).catch(()=>{});
  if(error instanceof Problem)throw error;
  throw new Problem(503,'Image generation failed. Reserved LOOX credits were released.');
 }
}
