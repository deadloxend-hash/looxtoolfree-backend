import sharp from 'sharp';
import {env,need,Problem,rows,rpc,supa,mac,uuid,authReady} from './core.js';
import {saveGeneratedMedia} from './media-store.js';

const catalog=[
 ['google_nano_2','Google AI','Nano Banana 2','gemini-3.1-flash-image',8,'LOOX_IMAGE_GOOGLE_API_KEY','Fast, versatile image creation'],
 ['google_nano_pro','Google AI','Nano Banana Pro','gemini-3-pro-image',18,'LOOX_IMAGE_GOOGLE_API_KEY','Detailed professional imagery'],
 ['bfl_flux2_pro','Black Forest Labs','FLUX.2 Pro','flux-2-pro',9,'LOOX_IMAGE_BFL_API_KEY','High fidelity prompt following'],
 ['bfl_klein_4b','Black Forest Labs','FLUX.2 Klein 4B','flux-2-klein-4b',5,'LOOX_IMAGE_BFL_API_KEY','Fast FLUX.2 creation'],
 ['ideogram_p_image','Ideogram','Ideogram P-Image','p-image-ideogram',7,'LOOX_IMAGE_IDEOGRAM_API_KEY','Fast image and typography'],
 ['ideogram_45','Ideogram','Ideogram 4.5','ideogram-4-5',13,'LOOX_IMAGE_IDEOGRAM_API_KEY','Precise creative design'],
 ['stability_sd35','Stability AI','Stable Diffusion 3.5 Large','sd3.5-large',10,'LOOX_IMAGE_STABILITY_API_KEY','Detailed diffusion images'],
 ['stability_ultra','Stability AI','Stable Image Ultra','ultra',12,'LOOX_IMAGE_STABILITY_API_KEY','High quality final images'],
 ['byteplus_45','BytePlus','Seedream 4.5','seedream-4-5-251128',8,'LOOX_IMAGE_BYTEPLUS_API_KEY','Polished creative images'],
 ['byteplus_50_flash','BytePlus','Seedream 5.0 Flash','dola-seedream-5-0-flash-260915',9,'LOOX_IMAGE_BYTEPLUS_API_KEY','Fast Seedream generation'],
 ['openai_gpt_image','OpenAI','GPT Image','gpt-image-2.5-flare',16,'LOOX_IMAGE_OPENAI_API_KEY','Precise image and text rendering'],
 ['z_image_turbo','Replicate','Z-Image Turbo','prunaai/z-image-turbo',3,'LOOX_IMAGE_REPLICATE_API_TOKEN','Fast Z-Image generation with local GPU priority'],
 ['replicate_qwen2','Replicate','Qwen Image 2','qwen/qwen-image-2',7,'LOOX_IMAGE_REPLICATE_API_TOKEN','Strong text and visual realism'],
 ['replicate_hidream','Replicate','HiDream-I1 Fast','prunaai/hidream-l1-fast',5,'LOOX_IMAGE_REPLICATE_API_TOKEN','Rapid creative images'],
 ['replicate_imagen4','Replicate','Imagen 4 Fast','google/imagen-4-fast',6,'LOOX_IMAGE_REPLICATE_API_TOKEN','Fast photographic creation'],
 ['replicate_photon','Replicate','Luma Photon','luma/photon',7,'LOOX_IMAGE_REPLICATE_API_TOKEN','Creative professional looks'],
 ['replicate_flux_ultra','Replicate','FLUX 1.1 Pro Ultra','black-forest-labs/flux-1.1-pro-ultra',9,'LOOX_IMAGE_REPLICATE_API_TOKEN','Detailed ultra images']
].map(([id,provider,name,modelId,cost,key,description])=>({id,provider,name,modelId,cost,key,description,operation:'generate_'+id}));
const legacyOperations=['generate_replicate','generate_google','generate_bfl','generate_ideogram','generate_stability','generate_byteplus','generate_openai'];
export const cloudOperations=[...legacyOperations,...catalog.map(m=>m.operation)];
// A credential and an operation row are necessary, but neither proves a paid request works.
// Enable a model only after a controlled successful paid smoke test and a checked cost.
export function imageCatalog(operations=[]){
 const verified=new Set((env.LOOX_IMAGE_VERIFIED_MODELS||'').split(',').map(s=>s.trim()));
 const suspended=new Set((env.LOOX_IMAGE_SUSPENDED_MODELS||'').split(',').map(s=>s.trim()));
 return catalog.map(m=>{
  // Z-Image Turbo is PC-only. An unrelated Replicate token must never make it
  // appear cloud-ready or authorize a paid fallback generation.
  if(m.id==='z_image_turbo')return {id:m.id,provider:'LOOX Studio',name:m.name,modelId:m.modelId,operation:m.operation,cost:m.cost,
   description:'Fast, expressive image generation',status:'coming_soon',available:false,
   reason:'Coming soon.'};
  const configured=Boolean(env[m.key]&&operations.some(o=>o.id===m.operation&&Number(o.cost)===m.cost));
  const unavailable=suspended.has(m.id);
  const available=configured&&verified.has(m.id)&&!unavailable;
  return {id:m.id,provider:m.provider,name:m.name,modelId:m.modelId,operation:m.operation,cost:m.cost,description:m.description,
   status:available?'available':unavailable?'temporarily_unavailable':'coming_soon',available,reason:available?'Ready to generate.':unavailable?'This provider is temporarily unavailable. No credits will be used.':'Requires rotated credentials, provider billing, and a verified generation.'};
 });
}
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
async function imageBytes(model,prompt,ratio,settings={}){
 const key=env[model.key]||(model.id==='z_image_turbo'?env.REPLICATE_API_TOKEN:null);
 if(model.provider==='OpenAI'){
  const size=ratio==='1:1'?'1024x1024':ratio==='16:9'||ratio==='4:3'?'1536x1024':'1024x1536';
  const result=await data(await request('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:model.modelId,prompt,size,quality:settings.quality||'medium',output_format:'png',n:1})}));
  need(result.data?.[0]?.b64_json,502,'Image model returned no result.');
  return Buffer.from(result.data[0].b64_json,'base64');
 }
 if(model.provider==='Google AI'){
  const result=await data(await request('https://generativelanguage.googleapis.com/v1/models/'+model.modelId+':generateContent',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['IMAGE'],responseFormat:{image:{aspectRatio:ratio,imageSize:settings.resolution||'1K'}}}})}));
  const part=result.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data);
  need(part,502,'Image model returned no result.');
  return Buffer.from(part.inlineData.data,'base64');
 }
 if(model.provider==='Stability AI'){
  const form=new FormData();form.set('prompt',prompt);form.set('aspect_ratio',ratio);form.set('output_format','png');
  const sd=model.id==='stability_sd35';
  if(sd)form.set('model','sd3.5-large');
  const r=await request('https://api.stability.ai/v2beta/stable-image/generate/'+(sd?'sd3':'ultra'),{method:'POST',headers:{Authorization:'Bearer '+key,Accept:'image/png'},body:form});
  return Buffer.from(await r.arrayBuffer());
 }
 if(model.provider==='Ideogram'){
  const result=await data(await request('https://api.ideogram.ai/v2/image/generate/'+model.modelId,{method:'POST',headers:{'Api-Key':key,'Content-Type':'application/json'},body:JSON.stringify({prompt,aspect_ratio:ratio.replace(':','x'),num_images:1,...(model.id==='ideogram_p_image'?{quality:settings.quality||'medium',resolution:settings.resolution||'1k'}:{})})}));
  need(result.data?.[0]?.is_image_safe!==false,422,'Image model declined the prompt.');
  return imageURL(result.data?.[0]?.url,['ideogram.ai']);
 }
 if(model.provider==='BytePlus'){
  const result=await data(await request('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:model.modelId,prompt,size:({'1:1':'1536x1536','16:9':'2048x1152','9:16':'1152x2048','4:3':'1792x1344','3:4':'1344x1792'})[ratio],response_format:'b64_json',watermark:false})}));
  if(result.data?.[0]?.b64_json)return Buffer.from(result.data[0].b64_json,'base64');
  return imageURL(result.data?.[0]?.url,['bytepluses.com','volces.com','tos-cn-beijing.volces.com']);
 }
 if(model.provider==='Replicate'){
  const dims=({'1:1':[1024,1024],'16:9':[1024,576],'9:16':[576,1024],'4:3':[1024,768],'3:4':[768,1024]})[ratio];
  const input=model.id==='z_image_turbo'?{prompt,width:dims[0],height:dims[1],num_inference_steps:8,guidance_scale:0,num_outputs:1,output_format:'png',enable_safety_filter:true}:{prompt,aspect_ratio:ratio};
  if(model.id==='replicate_flux_ultra')input.output_format='png';
  let result=await data(await request('https://api.replicate.com/v1/models/'+model.modelId+'/predictions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'wait=10','Cancel-After':'3m'},body:JSON.stringify({input})}));
  for(let i=0;i<30&&['starting','processing'].includes(result.status);i++){
   await delay(3000);
   result=await data(await request('https://api.replicate.com/v1/predictions/'+encodeURIComponent(result.id),{headers:{Authorization:'Bearer '+key}}));
  }
  need(result.status==='succeeded',502,'Image model did not finish in time.');
  return imageURL(Array.isArray(result.output)?result.output[0]:result.output,['replicate.delivery']);
 }
 if(model.provider==='Black Forest Labs'){
  const dims=({'1:1':[1024,1024],'16:9':[1344,768],'9:16':[768,1344],'4:3':[1152,896],'3:4':[896,1152]})[ratio];
  let result=await data(await request('https://api.bfl.ai/v1/'+model.modelId,{method:'POST',headers:{'x-key':key,'Content-Type':'application/json'},body:JSON.stringify({prompt,width:dims[0],height:dims[1],output_format:'png'})}));
  need(result.id&&result.polling_url,502,'Image model did not start.');
  const poll=new URL(result.polling_url);
  need(poll.protocol==='https:'&&poll.hostname==='api.bfl.ai',502,'Unexpected provider polling host.');
  for(let i=0;i<30;i++){
   await delay(2500);
   result=await data(await request(poll.href,{headers:{'x-key':key}}));
   if(result.status==='Ready')return imageURL(result.result?.sample,['bfl.ai','blackforestlabs.ai']);
   if(['Error','Failed','Request Moderated','Content Moderated'].includes(result.status))break;
  }
  throw new Problem(502,'Image model did not finish in time.');
 }
 throw new Problem(400,'Unknown image model.');
}
export async function cloudJob(u,b){
 need(authReady(),503,'Account service is unavailable.');
 if(b.model==='z_image_turbo'){
  const [health]=await rows('local_worker_health',{id:'eq.1',select:'modes,last_seen'});
  if(health?.modes?.includes('generate_z_image')&&Date.now()-Date.parse(health.last_seen)<90000){
   const {start}=await import('./jobs.js');
   return start(u,{...b,operation:'generate_z_image'});
  }
  // Never fall through to Replicate. No paid provider request or reservation.
  throw new Problem(503,'Z-Image Turbo is coming soon. No credits used.');
 }
 const model=catalog.find(m=>m.id===b.model);
 need(model,400,'Unknown image model.');
 need(imageCatalog(await rows('operations',{select:'id,cost'})).find(m=>m.id===model.id)?.available,503,'This image model is coming soon. Rotated credentials, provider billing and a successful verification are required. No credits used.');
 need(uuid.test(b.requestId),400,'Invalid request ID.');
 need(typeof b.prompt==='string'&&b.prompt.trim()&&b.prompt.length<=1200,400,'Enter a prompt of up to 1,200 characters.');
 need(ratios.includes(b.ratio),400,'Unsupported aspect ratio.');
 const settingRules=model.provider==='Google AI'?{resolution:['1K','2K','4K']}:model.id==='ideogram_p_image'?{resolution:['1k','2k'],quality:['medium','high']}:model.provider==='OpenAI'?{quality:['low','medium','high']}:{ };
 const settings=b.settings||{};
 need(settings&&typeof settings==='object'&&!Array.isArray(settings)&&Object.keys(settings).every(k=>settingRules[k]?.includes(settings[k])),400,'Unsupported model setting.');
 const [subscriptions,paid]=await Promise.all([
  rows('subscriptions',{user_id:'eq.'+u.id,select:'status,ends_at'}),
  rows('payments',{user_id:'eq.'+u.id,plan:'eq.lifetime',status:'eq.paid',select:'reference',limit:'1'})
 ]);
 if(model.id!=='z_image_turbo')need(subscriptions.some(s=>s.status==='active'||s.status==='cancelled'&&Date.parse(s.ends_at)>Date.now())||paid.length,403,'Premium image models require a LOOX plan.');
 const input={model:model.id,prompt:b.prompt.trim(),ratio:b.ratio,settings};
 const budget=Number(env.LOOX_DAILY_BUDGET_MILLICENTS);
 need(Number.isSafeInteger(budget)&&budget>0,503,'AI processing budget is not configured.');
 const job=await rpc('reserve',{p_user:u.id,p_digest:mac('cloud:'+JSON.stringify(input)),p_request:b.requestId,p_operation:model.operation,p_daily:1000000000,p_budget:budget});
 if(!job.fresh)return {id:job.id};
 try{
  await supa('/rest/v1/loox_jobs?'+new URLSearchParams({id:'eq.'+job.id,user_id:'eq.'+u.id}),{method:'PATCH',body:JSON.stringify({prompt:input.prompt,state:'processing'})});
  const raw=await imageBytes(model,input.prompt,input.ratio,input.settings);
  need(raw.length>0&&raw.length<32_000_000,502,'Image model returned an invalid result.');
  const png=await sharp(raw,{limitInputPixels:20_000_000,failOn:'warning'}).png().toBuffer();
  need(png.length<32_000_000,502,'Image is too large.');
  const media=await saveGeneratedMedia({user:u.id,id:job.id,bytes:png,type:'image/png'});
  await rpc('finish_media',{p_id:job.id,p_provider:'r2',p_key:media.key,p_thumbnail:media.thumbnail_key,p_type:media.type,p_bytes:media.bytes,p_sha256:media.sha256});
  return {id:job.id};
 }catch(error){
  await rpc('finish',{p_id:job.id,p_path:null}).catch(()=>{});
  if(error instanceof Problem)throw error;
  throw new Problem(503,'Image generation failed. Reserved LOOX credits were released.');
 }
}
