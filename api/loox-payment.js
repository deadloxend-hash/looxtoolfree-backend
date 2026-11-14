import {createHash} from 'node:crypto';
import {handler,method,raw,env,need,equal,mac,billingWebhookReady,rpc,supa,rows} from '../lib/core.js';
import {billingEvent} from '../lib/billing.js';
import {rechargeEvent} from '../src/billing/topups.js';
import {incident} from '../src/notifications/security-alerts.js';
export const config={api:{bodyParser:false}};
export default handler(async(req,res)=>{
 method(req,'POST');need(billingWebhookReady(),503,'Billing setup is pending.');
 const body=await raw(req,128000);
 if(!/^[a-f0-9]{64}$/i.test(req.headers['x-signature']||'')||!equal(req.headers['x-signature'],mac(body,env.LEMON_WEBHOOK_SECRET))){await incident('webhook_signature');need(false,403,'Invalid signature.');}
 let payload;try{payload=JSON.parse(body);}catch{need(false,400,'Invalid JSON.');}
 const event=payload?.meta?.event_name,resource=payload?.data;
 need(typeof event==='string'&&event.length<80&&resource&&['orders','subscriptions','subscription-invoices'].includes(resource.type)&&/^\d+$/.test(String(resource.id)),400,'Invalid payment event.');
 const digest=createHash('sha256').update(body).digest('hex');
 const claimed=await rpc('claim_payment_event',{p_digest:digest,p_event:event,p_reference:resource.type+'/'+resource.id});
 if(!claimed){const [previous]=await rows('payment_events',{digest:'eq.'+digest,select:'status'});need(previous?.status==='processed',503,'Payment event is still pending. Retry delivery.');return res.status(204).end();}
 try{
  if(!await rechargeEvent(payload))await billingEvent(payload);
  await supa('/rest/v1/loox_payment_events?digest=eq.'+digest,{method:'PATCH',body:JSON.stringify({status:'processed',updated_at:new Date().toISOString()})});
 }catch(e){
  await supa('/rest/v1/loox_payment_events?digest=eq.'+digest,{method:'PATCH',body:JSON.stringify({status:'failed',updated_at:new Date().toISOString()})}).catch(()=>{});
  await incident('payment_processing');throw e;
 }
 res.status(204).end();
},{cors:false});
