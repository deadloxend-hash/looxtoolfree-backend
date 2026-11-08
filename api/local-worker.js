import {env,need,handler,method,json,rows,rpc,supa,equal,uuid,Problem} from '../lib/core.js';

// This service never listens on the user's PC. The Windows worker polls over outbound HTTPS.
function authorized(req){
  const header=req.headers.authorization||'';
  need(typeof env.LOOX_WORKER_SECRET==='string'&&env.LOOX_WORKER_SECRET.length>=32,503,'Local GPU worker is not configured.');
  need(header.startsWith('Bearer ')&&equal(header.slice(7),env.LOOX_WORKER_SECRET),401,'Unauthorized worker.');
}
function modes(input){return Array.isArray(input)?[...new Set(input.filter(x=>x==='generate'||x==='generate_z_image'||x==='generate_reference'||x==='generate_video'||x==='face_swap'&&env.LOOX_FACE_SWAP_LICENSED==='true'))]:[]}
async function ownership(body) {
  need(uuid.test(body.id)&&uuid.test(body.lease),400,'Invalid job credentials.');
  const [q]=await rows('local_queue',{job_id:'eq.'+body.id,lease:'eq.'+body.lease,select:'job_id,user_id,operation,lease'});
  need(q,403,'Job lease is invalid or expired.');
  return q;
}
export default handler(async(req,res)=>{
  authorized(req);
  method(req,'POST');
  const b=json(req);
  const action=req.query.action;
  if(action==='ping'){
    const supported=modes(b.modes);
    await rpc('local_ping',{p_modes:supported});
    return res.json({online:true,modes:supported});
  }
  if(action==='claim'){
    const supported=modes(b.modes);
    need(supported.length>0,400,'No workflow is installed.');
    await rpc('local_ping',{p_modes:supported});
    const job=await rpc('local_claim',{p_modes:supported});
    return res.json({job:job||null});
  }
  if(action==='upload'){
    const q=await ownership(b);
    const path=q.user_id+'/'+q.job_id+(q.operation==='generate_video'?'.mp4':'.png');
    const r=await supa('/storage/v1/object/upload/sign/loox-results/'+path,{method:'POST',body:'{}'});
    need(typeof r.url==='string',503,'Storage could not prepare the upload.');
    const url=new URL(env.SUPABASE_URL.replace(/\/$/,'')+'/storage/v1'+r.url);
    need(url.origin===new URL(env.SUPABASE_URL).origin&&url.pathname==='/storage/v1/object/upload/sign/loox-results/'+path&&url.searchParams.has('token'),503,'Invalid storage upload target.');
    return res.json({upload_url:url.href,path,max_bytes:q.operation==='generate_video'?40_000_000:16_000_000});
  }
  if(action==='complete'){
    const q=await ownership(b);
    const path=b.success===true?q.user_id+'/'+q.job_id+(q.operation==='generate_video'?'.mp4':'.png'):null;
    // The database atomically verifies private storage existence, owner path,
    // size limits, and lease before marking a job successful.
    const ok=await rpc('local_complete',{p_id:b.id,p_lease:b.lease,p_path:path});
    need(ok,409,'Job already settled or lease expired.');
    return res.json({completed:true});
  }
  throw new Problem(404,'Unknown worker action.');
});
