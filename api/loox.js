import {memberTier,planTier,activeSubscription} from '../lib/plans.js';
import {workspaceAssetAction} from '../lib/workspace-assets.js';
import {enhancePrompt} from '../lib/prompt-enhancer.js';
import {communityAction} from '../lib/community-admin.js';
import {env,authenticate,account,aiReady,authReady,billingReady,handler,method,limit,need,rows,rpc,supa,json,mac} from '../lib/core.js';
import {start,status} from '../lib/jobs.js';
import {imageCatalog,cloudJob,cloudOperations} from '../lib/image-cloud.js';
import {videoCatalog,videoQuote,cloudVideoJob,cloudVideoStatus,cloudVideoOperations} from '../lib/video-cloud.js';
import {checkout,portal,checkoutPlans} from '../lib/billing.js';
import {templateAction} from '../lib/templates.js';
import {r2Ready,deleteR2Object} from '../lib/r2.js';
import {r2MediaAction} from '../lib/r2-media.js';
import {chatAttachmentAction} from '../lib/chat-attachments.js';
import {mediaURL,removeJobMedia} from '../lib/media-store.js';

// The D1 profile privacy flag is authoritative for all public R2 media.
// Legacy Supabase rows are still read during migration, but cannot override
// a private or unavailable Cloudflare creator identity.
async function cloudPublicProfile(id){
 if(!/^[a-f0-9-]{36}$/i.test(String(id||'')))return null;
 try{
  const response=await fetch('https://loox-profile-api.looxai-studio.workers.dev/v1/profile?id='+encodeURIComponent(id),
   {credentials:'omit',redirect:'error',signal:AbortSignal.timeout(9000)});
  if(!response.ok)return null;
  const p=await response.json();return p?.user_id===id?p:null;
 }catch{return null;}
}

async function publicMedia(req,res){
 const type=String(req.query.type||''),id=String(req.query.id||''),thumbnail=req.query.variant!=='original';
 let item=null;
 if(type==='post'){
  // Cloudflare D1 is authoritative. Legacy Supabase approval flags must never
  // grant access to media that has since been hidden, rejected or made private.
  need(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),400,'Invalid media ID.');
  const worker='https://loox-profile-api.looxai-studio.workers.dev/v1';
  const check=await fetch(worker+'/post?id='+encodeURIComponent(id),{redirect:'error',signal:AbortSignal.timeout(9000)});
  const publicPost=check.ok?await check.json().catch(()=>null):null;
  need(publicPost?.id===id&&publicPost.status==='approved'&&Boolean(publicPost.visible),404,'Public media is unavailable.');
  res.setHeader('Cache-Control','no-store, max-age=0');
  return res.json({url:worker+'/media?type=post&id='+encodeURIComponent(id)+'&variant='+(thumbnail?'preview':'original'),expires_in:300});
 }else if(type==='template'){
  const [template]=await rows('template_catalog',{id:'eq.'+id,active:'eq.true',select:'media_path,media_provider,media_key,thumbnail_key',limit:'1'});
  if(template)item={storage_provider:template.media_provider,object_key:template.media_key,thumbnail_key:template.thumbnail_key,result_path:template.media_path,legacy_bucket:'loox-templates'};
 }else if(type==='cover'||type==='avatar'){
  // Never expose or sign raw R2 keys from public profile metadata.
  // Let the canonical Cloudflare Worker enforce profile privacy and ownership.
  const profile=await cloudPublicProfile(id);
  need(profile&&(type==='cover'?profile.cover_key:profile.avatar_path),404,'Public media is unavailable.');
  res.setHeader('Cache-Control','no-store, max-age=0');
  return res.json({url:'https://loox-profile-api.looxai-studio.workers.dev/v1/media?type='+type+'&id='+encodeURIComponent(id),expires_in:300});
 }
 need(item,404,'Public media is unavailable.');
 const url=await mediaURL(item,{thumbnail,expires:300});need(url,404,'Public media is unavailable.');
 res.setHeader('Cache-Control','no-store, max-age=0');return res.json({url,expires_in:300});
}

async function overview(u){
 const own={user_id:'eq.'+u.id}, recent={...own,order:'created_at.desc',limit:'40'};
 const [profiles,wallets,credits,jobs,subscriptions,payments,lifetime]=await Promise.all([
  rows('profiles',{...own,select:'name,created_at,deleting'}),rows('wallets',{...own,select:'balance,debt'}),
  rows('credits',{...recent,select:'reason,amount,created_at,reference'}),
  rows('jobs',{...recent,select:'id,operation,cost,state,created_at'}),
  rows('subscriptions',{...own,order:'updated_at.desc',select:'plan,status,ends_at'}),
  rows('payments',{...recent,select:'plan,amount_cents,currency,status,created_at,reference'}),
  rows('payments',{...own,plan:'eq.lifetime',status:'eq.paid',select:'reference',limit:'1'})
 ]);
 const active=subscriptions.filter(s=>activeSubscription(s)),tier=active.some(s=>planTier(s.plan)==='pro')?'pro':active.some(s=>planTier(s.plan)==='creator')?'creator':'basic';
 return {profile:profiles[0],wallet:wallets[0],credits,jobs,subscriptions,payments,plan:lifetime.length?'pro':tier,legacyLifetime:Boolean(lifetime.length)};
}
async function removeAccount(u,password){
 need(typeof password==='string'&&password.length<=1024,400,'Confirm your password.');
 const verified=await fetch(env.SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password}),signal:AbortSignal.timeout(12000)});
 need(verified.ok&&(await verified.json()).user?.id===u.id,403,'Password verification failed.');
 await rpc('begin_delete',{p_user:u.id});
 const assets=await rows('user_assets',{user_id:'eq.'+u.id,select:'id,object_key,thumbnail_key',limit:'100'});
 for(const asset of assets){for(const key of [asset.object_key,asset.thumbnail_key])if(key.startsWith('users/'+u.id+'/'))await deleteR2Object(key);}

 // Paginate by deleting each batch before listing the next batch. Retrying resumes cleanup.
 for(let page=0;page<20;page++){
  const files=await supa('/storage/v1/object/list/loox-results',{method:'POST',body:JSON.stringify({prefix:u.id+'/',limit:100})});
  if(!files.length){
   await supa('/auth/v1/admin/users/'+u.id,{method:'DELETE'});return;
  }
  await supa('/storage/v1/object/loox-results',{method:'DELETE',body:JSON.stringify({prefixes:files.map(f=>u.id+'/'+f.name)})});
 }
 need(false,503,'Cleanup is underway. Retry deletion to finish.');
}
export default handler(async(req,res)=>{
 const action=req.query.action;
 if(typeof action==='string'&&action.startsWith('asset_'))return workspaceAssetAction(req,res,action.slice(6));
 if(typeof action==='string'&&action.startsWith('community_'))return communityAction(req,res,action.slice(10));
 if(action==='r2_media')return r2MediaAction(req,res);
 if(typeof action==='string'&&action.startsWith('chat_attachment_'))return chatAttachmentAction(req,res,action.slice('chat_attachment_'.length));
 if(typeof action==='string'&&action.startsWith('template_'))return templateAction(req,res,action.slice(9));
 if(action==='config'){
  method(req,'GET');
  let plans=[],operations=[],localWorker=null;
  if(authReady())[plans,operations,localWorker]=await Promise.all([rows('plans',{select:'id,price_cents,credits,cadence'}),rows('operations',{select:'id,cost'}),rows('local_worker_health',{id:'eq.1',select:'modes,last_seen'}).then(x=>x[0]).catch(()=>null)]);
  return res.json({workspace:{assets:r2Ready(),promptEnhancer:Boolean(env.GEMINI_API_KEY)},auth:authReady(),ai:aiReady(),billing:billingReady(),checkoutPlans:billingReady()?checkoutPlans():[],r2Media:{configured:r2Ready(),imagesOnly:true},testBilling:env.LEMON_MODE==='test',plans:plans.filter(p=>p.id!=='lifetime'),operations,rewards:{credits:5,interval_hours:12,balance_cap:50},local:{id:'flux',name:'FLUX.1 Schnell',cost:operations.find(o=>o.id==='generate')?.cost||3,available:Boolean(aiReady()&&localWorker?.modes?.includes('generate')&&Date.now()-Date.parse(localWorker.last_seen)<90000),referenceAvailable:Boolean(aiReady()&&localWorker?.modes?.includes('generate_reference')&&Date.now()-Date.parse(localWorker.last_seen)<90000)},models:imageCatalog(operations).map(m=>m.id==='z_image_turbo'?{...m,available:Boolean(m.available||aiReady()&&localWorker?.modes?.includes('generate_z_image')&&Date.now()-Date.parse(localWorker.last_seen)<90000),status:(m.available||aiReady()&&localWorker?.modes?.includes('generate_z_image')&&Date.now()-Date.parse(localWorker.last_seen)<90000)?'available':m.status}:m).concat([{id:'flux2_klein_local_edit',name:'FLUX.2 Klein 4B · Image Edit',provider:'LOOX Studio',description:'Reference image editing on your private GPU',cost:operations.find(o=>o.id==='generate_flux2_klein_edit')?.cost??3,operation:'generate_flux2_klein_edit',available:Boolean(aiReady()&&localWorker?.modes?.includes('generate_flux2_klein_edit')&&Date.now()-Date.parse(localWorker.last_seen)<90000),status:aiReady()&&localWorker?.modes?.includes('generate_flux2_klein_edit')&&Date.now()-Date.parse(localWorker.last_seen)<90000?'available':'temporarily_unavailable',reason:'Select a reference image and enter an editing prompt. Requires the updated Windows GPU worker.'}]),videoModels:videoCatalog(operations),faceSwap:{available:Boolean(env.LOOX_FACE_SWAP_LICENSED==='true'&&aiReady()&&localWorker?.modes?.includes('face_swap')&&Date.now()-Date.parse(localWorker.last_seen)<90000),cost:operations.find(o=>o.id==='face_swap')?.cost??6},
   ...(authReady()?{url:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY}:{})});
 }
 if(action==='public_plan'){method(req,'GET');need(/^[a-f0-9-]{36}$/i.test(String(req.query.id||'')),400,'Invalid profile.');return res.json({plan:await memberTier(req.query.id)});}
 if(action==='public_media'){method(req,'GET');return publicMedia(req,res);}
 const u=await authenticate(req);
 await limit(u,'api',100);
 await account(u);
 if(action==='enhance_prompt'){method(req,'POST');return res.json(await enhancePrompt(u,json(req)));}
 if(action==='reward'){method(req,'GET');return res.json(await rpc('reward',{p_user:u.id,p_fingerprint:mac('bonus:'+u.email.trim().toLowerCase()),p_claim:false}));}
 if(action==='account'){method(req,'GET');return res.json(await overview(u));}
 if(action==='gpu'){
  method(req,'GET');
  const [worker]=await rows('local_worker_health',{id:'eq.1',select:'modes,last_seen'});
  const online=Boolean(aiReady()&&worker&&Date.now()-Date.parse(worker.last_seen)<90000);
  return res.json({online,model:'FLUX.1 Schnell + Wan 2.1 T2V',image:online&&worker.modes.includes('generate'),video:online&&worker.modes.includes('generate_video')});
 }
 if(action==='quota'){
  method(req,'GET');
  const day=new Date().toISOString().slice(0,10);
  const start=day+'T00:00:00.000Z';
  const jobs=await rows('jobs',{user_id:'eq.'+u.id,created_at:'gte.'+start,
   operation:'in.('+['generate','generate_z_image','generate_video',...cloudOperations,...cloudVideoOperations].join(',')+')',state:'neq.failed',select:'operation',limit:'1000'});
  const used={generate:0,generate_video:0};
  for(const job of jobs){if(job.operation==='generate_video'||cloudVideoOperations.includes(job.operation))used.generate_video++;else if(job.operation.startsWith('generate'))used.generate++;}
  const tier=await memberTier(u.id),limit=tier==='pro'?250:tier==='creator'?100:25;
  return res.json({limit,used,remaining:{generate:Math.max(0,limit-used.generate),
   generate_video:Math.max(0,limit-used.generate_video)},reset_at:new Date(Date.parse(start)+86400000).toISOString()});
 }
 if(action==='gallery'){
  method(req,'GET');
  const offset=Number(req.query.offset||0);
  need(Number.isInteger(offset)&&offset>=0&&offset<=240,400,'Invalid history page.');
  const operation=req.query.operation==='generate_video'?'generate_video':'generate';
  const query=String(req.query.q||'').trim().slice(0,100).replace(/[\\%_*]/g,'');
  const jobs=await rows('jobs',{...(query?{prompt:'ilike.*'+query+'*'}:{}),user_id:'eq.'+u.id,operation:operation==='generate'?'in.('+['generate','generate_z_image','generate_flux2_klein_edit',...cloudOperations].join(',')+')':'in.('+['generate_video',...cloudVideoOperations].join(',')+')',state:'eq.succeeded',result_path:'not.is.null',
   select:'id,prompt,operation,created_at,result_path,storage_provider,object_key,thumbnail_key,media_type',order:'created_at.desc',limit:'12',offset:String(offset)});
  const items=await Promise.all(jobs.map(async j=>{
   let url=null;
   try{url=await mediaURL(j,{thumbnail:true});}catch{}
   return {id:j.id,prompt:j.prompt||null,model:j.operation.replace(/^generate_?/, '')||'flux',created_at:j.created_at,url};
  }));
  return res.json({items,has_more:jobs.length===12});
 }
 if(action==='status_batch'){
  method(req,'GET');
  const ids=String(req.query.ids||'').split(',').filter(Boolean);need(ids.length>0&&ids.length<=40&&ids.every(id=>/^[a-f0-9-]{36}$/i.test(id)),400,'Invalid job list.');
  const jobs=await rows('jobs',{id:'in.('+ids.join(',')+')',user_id:'eq.'+u.id,select:'id,state,failure_code,result_path,storage_provider,object_key,thumbnail_key,media_type'});
  const items=await Promise.all(jobs.map(async job=>({id:job.id,state:job.state,failure_code:job.failure_code||null,url:job.state==='succeeded'?await mediaURL(job,{thumbnail:true}).catch(()=>null):null})));
  return res.json({items});
 }
 if(action==='status'){method(req,'GET');const [j]=await rows('jobs',{id:'eq.'+req.query.id,user_id:'eq.'+u.id,select:'operation'});return res.json(j&&cloudVideoOperations.includes(j.operation)?await cloudVideoStatus(u,req.query.id):await status(u,req.query.id));}
 method(req,'POST');const b=json(req);
 if(action==='claim_reward'){await limit(u,'reward',4,60);const ip=String(req.headers['x-vercel-forwarded-for']||'').split(',')[0].trim();if(ip)await limit({id:mac('return-ip:'+ip)},'reward-network',20,86400);return res.json(await rpc('reward',{p_user:u.id,p_fingerprint:mac('bonus:'+u.email.trim().toLowerCase()),p_claim:true}));}
 if(action==='video_quote'){await limit(u,'video_quote',60);return res.json(videoQuote(u,b,await rows('operations',{select:'id,cost'})));}
 if(action==='job'){await limit(u,'submit',8);return res.status(202).json(await start(u,b));}
 if(action==='cloud_job'){await limit(u,'submit',8);return res.status(202).json(await cloudJob(u,b));}
 if(action==='cloud_video_job'){await limit(u,'submit',8);return res.status(202).json(await cloudVideoJob(u,b));}
 if(action==='delete_image'){
  await limit(u,'delete_image',20,600);
  need(typeof b.id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(b.id),400,'Invalid image ID.');
  const [job]=await rows('jobs',{id:'eq.'+b.id,user_id:'eq.'+u.id,operation:'in.('+['generate','generate_z_image','generate_flux2_klein_edit',...cloudOperations].join(',')+')',
   state:'eq.succeeded',select:'id,result_path,storage_provider,object_key,thumbnail_key'});
  need(job,404,'Image not found.');
  if(job.result_path||job.object_key){
   need(!job.result_path||job.result_path.startsWith(u.id+'/'),403,'Invalid image path.');
   await removeJobMedia(job);
   await supa('/rest/v1/loox_jobs?'+new URLSearchParams({id:'eq.'+job.id,user_id:'eq.'+u.id}),{
    method:'PATCH',body:JSON.stringify({result_path:null,object_key:null,thumbnail_key:null})
   });
  }
  return res.json({deleted:true});
 }
 if(action==='delete'){await limit(u,'delete',3,600);await removeAccount(u,b.password);return res.json({deleted:true});}
 const [profile]=await rows('profiles',{user_id:'eq.'+u.id,select:'deleting'});
 need(profile&&!profile.deleting,409,'Account deletion is in progress.');
 if(action==='checkout'){await limit(u,'checkout',3,600);return res.json(await checkout(u,b.plan));}
 if(action==='portal'){await limit(u,'portal',6);return res.json(await portal(u));}
 if(action==='profile'){
  need(typeof b.name==='string'&&b.name.trim().length>0&&b.name.trim().length<=80,400,'Enter a name of up to 80 characters.');
  await supa('/rest/v1/loox_profiles?user_id=eq.'+u.id,{method:'PATCH',body:JSON.stringify({name:b.name.trim()})});
  return res.json({saved:true});
 }
 need(false,404,'Unknown action.');
});
