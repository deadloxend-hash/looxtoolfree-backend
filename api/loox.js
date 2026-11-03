import {env,authenticate,account,aiReady,authReady,billingReady,handler,method,limit,need,rows,rpc,supa,json} from '../lib/core.js';
import {start,status} from '../lib/jobs.js';
import {checkout,portal} from '../lib/billing.js';

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
 const pro=subscriptions.some(s=>s.status==='active'||s.status==='cancelled'&&Date.parse(s.ends_at)>Date.now());
 return {profile:profiles[0],wallet:wallets[0],credits,jobs,subscriptions,payments,plan:pro?'pro':lifetime.length?'lifetime':'free'};
}
async function removeAccount(u,password){
 need(typeof password==='string'&&password.length<=1024,400,'Confirm your password.');
 const verified=await fetch(env.SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password}),signal:AbortSignal.timeout(12000)});
 need(verified.ok&&(await verified.json()).user?.id===u.id,403,'Password verification failed.');
 await rpc('begin_delete',{p_user:u.id});
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
 if(action==='config'){
  method(req,'GET');
  let plans=[],operations=[];
  if(authReady())[plans,operations]=await Promise.all([rows('plans',{select:'id,price_cents,credits,cadence'}),rows('operations',{select:'id,cost'})]);
  return res.json({auth:authReady(),ai:aiReady(),billing:billingReady(),testBilling:env.LEMON_MODE==='test',plans,operations,
   ...(authReady()?{url:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY}:{})});
 }
 const u=await authenticate(req);
 await limit(u,'api',100);
 await account(u);
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
   operation:'in.(generate,generate_video)',select:'operation',limit:'1000'});
  const used={generate:0,generate_video:0};
  for(const job of jobs){if(Object.hasOwn(used,job.operation))used[job.operation]++;}
  const limit=30;
  return res.json({limit,used,remaining:{generate:Math.max(0,limit-used.generate),
   generate_video:Math.max(0,limit-used.generate_video)},reset_at:new Date(Date.parse(start)+86400000).toISOString()});
 }
 if(action==='gallery'){
  method(req,'GET');
  const offset=Number(req.query.offset||0);
  need(Number.isInteger(offset)&&offset>=0&&offset<=240,400,'Invalid history page.');
  const operation=req.query.operation==='generate_video'?'generate_video':'generate';
  const jobs=await rows('jobs',{user_id:'eq.'+u.id,operation:'eq.'+operation,state:'eq.succeeded',
   select:'id,prompt,created_at,result_path',order:'created_at.desc',limit:'12',offset:String(offset)});
  const items=await Promise.all(jobs.map(async j=>{
   let url=null;
   if(j.result_path){
    try{
     const signed=await supa('/storage/v1/object/sign/loox-results/'+j.result_path,{method:'POST',body:JSON.stringify({expiresIn:300})});
     if(signed?.signedURL)url=env.SUPABASE_URL+'/storage/v1'+signed.signedURL;
    }catch{}
   }
   return {id:j.id,prompt:j.prompt||null,created_at:j.created_at,url};
  }));
  return res.json({items,has_more:jobs.length===12});
 }
 if(action==='status'){method(req,'GET');return res.json(await status(u,req.query.id));}
 method(req,'POST');const b=json(req);
 if(action==='job'){await limit(u,'submit',8);return res.status(202).json(await start(u,b));}
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
