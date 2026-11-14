import {createHash} from 'node:crypto';
import {need,equal,mac,env,rpc} from '../../lib/core.js';
export async function verifyWorkerSignature(req,body){
 const signature=req.headers['x-loox-signature'];
 if(!signature){need(env.LOOX_WORKER_SIGNED_REQUESTS_REQUIRED!=='true',401,'Signed worker request required.');return;}
 const timestamp=String(req.headers['x-loox-timestamp']||''),nonce=String(req.headers['x-loox-nonce']||''),action=String(req.query.action||'');
 need(/^\d{10}$/.test(timestamp)&&Math.abs(Date.now()/1000-Number(timestamp))<=90&&/^[a-f0-9]{32}$/.test(nonce)&&/^[a-f0-9]{64}$/.test(signature),401,'Invalid worker signature.');
 const digest=createHash('sha256').update(body).digest('hex');
 need(equal(signature,mac(['POST',action,timestamp,nonce,digest].join('\n'),env.LOOX_WORKER_SECRET)),401,'Invalid worker signature.');
 await rpc('worker_nonce',{p_nonce:nonce});
}
