import {env,need,handler,method,json,rows,rpc,supa,equal,mac,uuid,Problem} from '../lib/core.js';
import {userKey,verifyUploadedMedia} from '../lib/media-store.js';
import {getR2Object,presignR2Object} from '../lib/r2.js';

// This service never listens on the user's PC. The Windows worker polls over outbound HTTPS.
function authorized(req){
  const header=req.headers.authorization||'';
  need(typeof env.LOOX_WORKER_SECRET==='string'&&env.LOOX_WORKER_SECRET.length>=32,503,'Local GPU worker is not configured.');
  need(header.startsWith('Bearer ')&&equal(header.slice(7),env.LOOX_WORKER_SECRET),401,'Unauthorized worker.');
}
function modes(input){return Array.isArray(input)?[...new Set(input.filter(x=>x==='generate'||x==='generate_z_image'||x==='generate_flux2_klein_edit'||x==='generate_reference'||x==='generate_video'||x==='face_swap'&&env.LOOX_FACE_SWAP_LICENSED==='true'))]:[]}
async function ownership(body) {
  need(uuid.test(body.id)&&uuid.test(body.lease),400,'Invalid job credentials.');
  const [q]=await rows('local_queue',{job_id:'eq.'+body.id,lease:'eq.'+body.lease,select:'job_id,user_id,operation,lease'});
  need(q,403,'Job lease is invalid or expired.');
  return q;
}
export default handler(async(req,res)=>{
  if(req.method==='GET'&&req.query.action==='input'){
    const key=String(req.query.path||''),exp=Number(req.query.exp),sig=String(req.query.sig||'');
    need(/^users\/[a-f0-9-]{36}\/inputs\/[a-z0-9._-]+$/i.test(key)&&Number.isInteger(exp)&&exp>=Math.floor(Date.now()/1000)&&exp<=Math.floor(Date.now()/1000)+7205,403,'Worker media link expired.');
    need(/^[a-f0-9]{64}$/.test(sig)&&equal(sig,mac('worker-media:'+key+':'+exp)),403,'Invalid worker media link.');
    const media=await getR2Object(key);need(media.type==='image/png'&&media.bytes.length<=8_000_000,415,'Worker input is invalid.');
    res.setHeader('Content-Type','image/png');res.setHeader('Content-Length',String(media.bytes.length));res.setHeader('Cache-Control','private, no-store');return res.end(media.bytes);
  }
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
    const type=q.operation==='generate_video'?'video/mp4':'image/png';
    const path=userKey(q.user_id,'generations',q.job_id,type);
    return res.json({upload_url:presignR2Object('PUT',path,{expires:900,contentType:type}),path,content_type:type,max_bytes:q.operation==='generate_video'?40_000_000:16_000_000});
  }
  if(action==='complete'){
    const q=await ownership(b);
    if(b.success!==true){
     const ok=await rpc('local_complete',{p_id:b.id,p_lease:b.lease,p_path:null});
     need(ok,409,'Job already settled or lease expired.');
     return res.json({completed:true});
    }
    const type=q.operation==='generate_video'?'video/mp4':'image/png';
    const media=await verifyUploadedMedia({user:q.user_id,id:q.job_id,type,expectedSha:typeof b.sha256==='string'?b.sha256:null});
    const ok=await rpc('local_complete_media',{p_id:b.id,p_lease:b.lease,p_provider:'r2',p_key:media.key,p_thumbnail:media.thumbnail_key,p_type:media.type,p_bytes:media.bytes,p_sha256:media.sha256});
    need(ok,409,'Job already settled or lease expired.');
    return res.json({completed:true});
  }
  throw new Problem(404,'Unknown worker action.');
},{cors:false});
