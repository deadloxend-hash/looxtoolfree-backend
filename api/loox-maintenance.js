import {method,handler,env,need,equal,rows,supa,rpc} from '../lib/core.js';
import {reconcile} from '../lib/jobs.js';
import {cloudOperations} from '../lib/image-cloud.js';
export default handler(async(req,res)=>{
 method(req,'GET');need(env.CRON_SECRET&&equal(req.headers.authorization,'Bearer '+env.CRON_SECRET),401,'Unauthorized.');
 await rpc('local_expire',{});
 const staleCloud=await rows('jobs',{state:'in.(reserved,processing)',operation:'in.('+cloudOperations.join(',')+')',created_at:'lt.'+new Date(Date.now()-10*60000).toISOString(),select:'id',limit:'100'});
 for(const job of staleCloud)await rpc('finish',{p_id:job.id,p_path:null});
 const jobs=await rows('jobs',{state:'in.(reserved,processing)',prediction:'not.is.null',order:'created_at.asc',limit:'40'});
 const results=[];
 for(let i=0;i<jobs.length;i+=3)results.push(...await Promise.allSettled(jobs.slice(i,i+3).map(reconcile)));
 const finished=await rows('jobs',{state:'in.(failed,succeeded)',inputs_clean:'eq.false',select:'id,user_id',limit:'200'});
 if(finished.length){
  const prefixes=finished.flatMap(j=>['image','mask'].map(f=>j.user_id+'/'+j.id+'-'+f+'.png'));
  await supa('/storage/v1/object/loox-results',{method:'DELETE',body:JSON.stringify({prefixes})});
  await supa('/rest/v1/loox_jobs?id=in.('+finished.map(j=>j.id).join(',')+')',{method:'PATCH',body:JSON.stringify({inputs_clean:true})});
 }
 await supa('/rest/v1/loox_limits?expires_at=lt.'+encodeURIComponent(new Date().toISOString()),{method:'DELETE'});
 res.status(results.some(x=>x.status==='rejected')?503:200).json({checked:jobs.length});
},{cors:false});
