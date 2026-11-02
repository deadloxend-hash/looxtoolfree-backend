import {createHmac} from 'node:crypto';
import {method,raw,env,need,uuid,equal,mac,handler,rows} from '../lib/core.js';
import {bind,reconcile} from '../lib/jobs.js';
export const config={api:{bodyParser:false}};
export default handler(async(req,res)=>{
 method(req,'POST');
 const id=req.query.job, h=req.headers, t=h['webhook-timestamp'];
 need(uuid.test(id)&&env.REPLICATE_WEBHOOK_SIGNING_SECRET&&equal(req.query.bind,mac('prediction:'+id)),403,'Invalid callback.');
 need(/^\d+$/.test(t)&&Math.abs(Date.now()/1000-Number(t))<300,403,'Expired callback.');
 const body=await raw(req,3_000_000),key=Buffer.from(env.REPLICATE_WEBHOOK_SIGNING_SECRET.replace(/^whsec_/,''),'base64');
 const signature=createHmac('sha256',key).update(h['webhook-id']+'.'+t+'.').update(body).digest('base64');
 need(String(h['webhook-signature']).split(' ').some(s=>equal(s,'v1,'+signature)),403,'Invalid signature.');
 const p=JSON.parse(body);await bind(id,p.id);
 const [job]=await rows('jobs',{id:'eq.'+id,prediction:'eq.'+p.id,select:'*'});
 if(job)await reconcile(job);
 res.status(204).end();
},{cors:false});
