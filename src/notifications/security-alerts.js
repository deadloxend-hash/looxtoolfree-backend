import {createHash} from 'node:crypto';
import {rpc,rows,supa,env,frontURL} from '../../lib/core.js';
export const incidents={
 webhook_signature:['critical','payments','Payment webhook signature verification failed.','Review webhook configuration and repeated unauthorized requests.'],
 payment_processing:['critical','payments','A payment event could not be processed.','Review provider records and internal payment history before granting credits.'],
 unauthorized_admin:['high','security','Financial administrator access was denied.','Review administrator access and MFA enrollment.'],
 reconciliation:['critical','payments','Payment or credit reconciliation needs review.','Compare provider transaction records with the internal ledger.'],
 generation_failure:['high','generation','Generation failure rate exceeded the monitoring threshold.','Review model availability and processing costs.'],
 simulated:['high','monitoring','Safe simulated security incident. No payment or credit was changed.','Confirm this test alert reaches the configured administrator inbox.']
};
export async function incident(category){
 const spec=incidents[category];if(!spec)return;
 // Fixed templates only: never copy request bodies, tokens, email addresses or errors.
 console.error(JSON.stringify({event:'loox_incident',category,severity:spec[0],service:spec[1],timestamp:new Date().toISOString()}));
 try{await rpc('security_incident',{p_key:createHash('sha256').update(category).digest('hex'),p_category:category,p_severity:spec[0],p_service:spec[1]});if(emailReady())await deliverAlerts();}catch{console.error(JSON.stringify({event:'loox_monitoring_unavailable',category}));}
}
export const emailReady=()=>Boolean(env.SECURITY_ALERT_EMAIL&&env.RESEND_API_KEY&&env.SECURITY_ALERT_FROM);
export async function deliverAlerts(){
 if(!emailReady())return {configured:false,sent:0};
 const items=await rpc('claim_alerts',{});let sent=0;
 for(const item of items){
  const spec=incidents[item.category];if(!spec)continue;
  try{
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'loox-alert-'+item.id},body:JSON.stringify({from:env.SECURITY_ALERT_FROM,to:[env.SECURITY_ALERT_EMAIL],subject:'[LOOX SECURITY] '+spec[0].toUpperCase()+' '+spec[1]+' alert',text:['Category: '+item.category,'Severity: '+spec[0],'Timestamp (UTC): '+item.created_at,'Affected service: '+spec[1],spec[2],'Suggested action: '+spec[3],'Admin dashboard: '+frontURL()+'billing-admin.html'].join('\n')}),signal:AbortSignal.timeout(10000),redirect:'error'});
   if(!response.ok)throw Error('delivery');
   await supa('/rest/v1/loox_security_alerts?id=eq.'+item.id,{method:'PATCH',body:JSON.stringify({sent_at:new Date().toISOString()})});sent++;
  }catch{console.error(JSON.stringify({event:'loox_alert_delivery_failed',category:item.category}));}
 }
 return {configured:true,sent};
}
