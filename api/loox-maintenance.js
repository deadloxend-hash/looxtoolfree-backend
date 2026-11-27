import {engineRecord,engineStatus} from '../src/ai/engine.js';
import {monitorBilling} from '../src/billing/monitoring.js';
import {deliverAlerts,incident} from '../src/notifications/security-alerts.js';
import {method,handler,env,need,equal,rows,supa,rpc} from '../lib/core.js';
import {reconcile} from '../lib/jobs.js';
import {cloudOperations} from '../lib/image-cloud.js';
import {cloudVideoOperations,cloudVideoStatus} from '../lib/video-cloud.js';
import {migrateMediaBatch} from '../lib/r2-migration.js';
import {cleanupInputs} from '../lib/input-cleanup.js';
import {deleteR2Object} from '../lib/r2.js';
export default handler(async(req,res)=>{
 method(req,'GET');
 const authorization=req.headers.authorization||'';
 const cron=env.CRON_SECRET&&equal(authorization,'Bearer '+env.CRON_SECRET);
 need(cron,401,'Unauthorized.');
 if(req.query.action==='r2_migrate')return res.json(await migrateMediaBatch(Number(req.query.limit||8)));
 // Only short-lived proof hashes created by the privacy workflow, never user content.
 await supa('/rest/v1/loox_privacy_proofs?expires_at=lt.'+encodeURIComponent(new Date(Date.now()-86400000).toISOString()),{method:'DELETE'});
 await monitorBilling();
 const spend=await rpc('engine_spending_health',{});
 if(spend.day>=spend.daily_limit*.8||spend.month>=spend.monthly_limit*.8)await incident('ai_spending');
 await deliverAlerts();
 await rpc('local_expire',{});
 const staleCloud=await rows('jobs',{state:'in.(reserved,processing)',operation:'in.('+cloudOperations.join(',')+')',created_at:'lt.'+new Date(Date.now()-10*60000).toISOString(),select:'id',limit:'100'});
 for(const job of staleCloud){const e=await engineRecord(job.id);if(e){if(e.prediction_id)await engineStatus({id:e.user_id},job.id).catch(()=>{});continue;}await rpc('finish',{p_id:job.id,p_path:null});}
 const jobs=await rows('jobs',{state:'in.(reserved,processing)',prediction:'not.is.null',
  operation:'not.in.('+cloudVideoOperations.join(',')+')',order:'created_at.asc',limit:'40'});
 const results=[];
 for(let i=0;i<jobs.length;i+=3)results.push(...await Promise.allSettled(jobs.slice(i,i+3).map(async job=>(await engineRecord(job.id))?engineStatus({id:job.user_id},job.id):reconcile(job))));
 // Cloud video predictions are MP4 files, not PNG images; reconcile them separately.
 const videos=await rows('jobs',{state:'in.(reserved,processing)',operation:'in.('+cloudVideoOperations.join(',')+')',
  order:'created_at.asc',limit:'12',select:'id,user_id'});
 for(const video of videos)results.push(await Promise.resolve()
  .then(()=>cloudVideoStatus({id:video.user_id},video.id))
  .then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason})));
 const finished=await rows('jobs',{state:'in.(failed,succeeded)',inputs_clean:'eq.false',select:'id,user_id',limit:'200'});
 const cleanup=await cleanupInputs(finished,{
  removeLegacy:prefixes=>supa('/storage/v1/object/loox-results',{method:'DELETE',body:JSON.stringify({prefixes})}),
  removeObject:deleteR2Object,
  markClean:ids=>supa('/rest/v1/loox_jobs?id=in.('+ids.join(',')+')',{method:'PATCH',body:JSON.stringify({inputs_clean:true})})
 });

 await supa('/rest/v1/loox_limits?expires_at=lt.'+encodeURIComponent(new Date().toISOString()),{method:'DELETE'});
 res.status(results.some(x=>x.status==='rejected')||cleanup.pending?503:200).json({checked:jobs.length+videos.length,cleanup_pending:cleanup.pending});
},{cors:false});
