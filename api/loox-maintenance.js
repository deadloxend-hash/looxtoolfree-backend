import {method,handler,env,need,equal,rows,supa,rpc} from '../lib/core.js';
import {reconcile} from '../lib/jobs.js';
import {cloudOperations} from '../lib/image-cloud.js';
import {cloudVideoOperations,cloudVideoStatus} from '../lib/video-cloud.js';
import {migrateMediaBatch} from '../lib/r2-migration.js';
import {userKey} from '../lib/media-store.js';
import {deleteR2Object} from '../lib/r2.js';
export default handler(async(req,res)=>{
 method(req,'GET');
 const authorization=req.headers.authorization||'';
 const cron=env.CRON_SECRET&&equal(authorization,'Bearer '+env.CRON_SECRET);
 const migration=req.query.action==='r2_migrate'&&env.LOOX_MIGRATION_TOKEN&&equal(authorization,'Bearer '+env.LOOX_MIGRATION_TOKEN);
 need(cron||migration,401,'Unauthorized.');
 if(req.query.action==='r2_migrate')return res.json(await migrateMediaBatch(Number(req.query.limit||8)));
 await rpc('local_expire',{});
 const staleCloud=await rows('jobs',{state:'in.(reserved,processing)',operation:'in.('+cloudOperations.join(',')+')',created_at:'lt.'+new Date(Date.now()-10*60000).toISOString(),select:'id',limit:'100'});
 for(const job of staleCloud)await rpc('finish',{p_id:job.id,p_path:null});
 const jobs=await rows('jobs',{state:'in.(reserved,processing)',prediction:'not.is.null',
  operation:'not.in.('+cloudVideoOperations.join(',')+')',order:'created_at.asc',limit:'40'});
 const results=[];
 for(let i=0;i<jobs.length;i+=3)results.push(...await Promise.allSettled(jobs.slice(i,i+3).map(reconcile)));
 // Cloud video predictions are MP4 files, not PNG images; reconcile them separately.
 const videos=await rows('jobs',{state:'in.(reserved,processing)',operation:'in.('+cloudVideoOperations.join(',')+')',
  order:'created_at.asc',limit:'12',select:'id,user_id'});
 for(const video of videos)results.push(await Promise.resolve()
  .then(()=>cloudVideoStatus({id:video.user_id},video.id))
  .then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason})));
 const finished=await rows('jobs',{state:'in.(failed,succeeded)',inputs_clean:'eq.false',select:'id,user_id',limit:'200'});
 if(finished.length){
  const prefixes=finished.flatMap(j=>['image','mask','target_image','swap_image','reference_image'].map(f=>j.user_id+'/'+j.id+'-'+f+'.png'));
  await supa('/storage/v1/object/loox-results',{method:'DELETE',body:JSON.stringify({prefixes})});
  const inputKeys=finished.flatMap(j=>['target_image','swap_image','reference_image','video-source'].map(f=>userKey(j.user_id,'inputs',j.id,'image/png','-'+f)));
  for(let i=0;i<inputKeys.length;i+=10)await Promise.allSettled(inputKeys.slice(i,i+10).map(deleteR2Object));
  await supa('/rest/v1/loox_jobs?id=in.('+finished.map(j=>j.id).join(',')+')',{method:'PATCH',body:JSON.stringify({inputs_clean:true})});
 }
 await supa('/rest/v1/loox_limits?expires_at=lt.'+encodeURIComponent(new Date().toISOString()),{method:'DELETE'});
 res.status(results.some(x=>x.status==='rejected')?503:200).json({checked:jobs.length+videos.length});
},{cors:false});
