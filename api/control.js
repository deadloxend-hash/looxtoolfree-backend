import {handler,authenticate,method,need,limit,rows,rpc,supa,json,uuid,env} from '../lib/core.js';
import {mediaURL} from '../lib/media-store.js';
import {flags} from '../src/config/billing.js';
import {r2Ready} from '../lib/r2.js';
import {imageCatalog} from '../lib/image-cloud.js';
import {videoCatalog} from '../lib/video-cloud.js';
const page=req=>{const n=Number(req.query.page||1);need(Number.isInteger(n)&&n>=1&&n<=10000,400,'Invalid page.');return n;};
const text=(x,max=100)=>String(x||'').trim().slice(0,max);
const list=(table,select,req,filter={})=>rows(table,{select,order:'created_at.desc',limit:'26',offset:String((page(req)-1)*25),...filter}).then(a=>({items:a.slice(0,25),has_more:a.length>25,page:page(req)}));
export async function controlIdentity(req,u){
 const c=req.looxAuthClaims;
 need(c?.sub===u.id&&c.aal==='aal2',403,'Verify your authenticator to open the Control Center.');
 need(uuid.test(c.session_id)&&await rpc('control_session',{p_user:u.id,p_session:c.session_id}),401,'Administrator session ended. Sign in again.');
 const [role]=await rows('admin_roles',{user_id:'eq.'+u.id,active:'eq.true',select:'role,permissions',limit:'1'});
 need(role,403,'Administrator access required.');return role;
}
async function permit(u,permission){need(await rpc('control_permission',{p_actor:u.id,p_permission:permission}),403,'Your role does not permit this operation.');}
function mutation(body){need(uuid.test(body.requestId)&&typeof body.reason==='string'&&body.reason.trim().length>=5&&body.reason.length<=500,400,'Enter a reason of 5–500 characters.');}
export default handler(async(req,res)=>{
 const action=text(req.query.action,60),u=await authenticate(req);
 await limit(u,'control-api',90,60);
 // Customer support endpoints intentionally do not require admin access.
 if(action==='support_mine'){method(req,'GET');return res.json(await list('support_tickets','id,subject,category,status,priority,reference,created_at,updated_at',req,{user_id:'eq.'+u.id}));}
 if(action==='support_create'){
  method(req,'POST');await limit(u,'support-create',5,3600);const b=json(req);need(uuid.test(b.requestId),400,'Invalid request ID.');
  return res.status(201).json(await rpc('support_create',{p_user:u.id,p_subject:text(b.subject,160),p_category:text(b.category,40),p_body:text(b.body,6000),p_reference:text(b.reference,200),p_request:b.requestId}));
 }
 if(action==='support_thread'||action==='support_reply'){
  method(req,action==='support_thread'?'GET':'POST');const b=action==='support_reply'?json(req):req.query;need(uuid.test(b.id),400,'Invalid ticket ID.');
  const [ticket]=await rows('support_tickets',{id:'eq.'+b.id,user_id:'eq.'+u.id,select:'id,status',limit:'1'});need(ticket,404,'Support ticket not found.');
  if(action==='support_thread')return res.json(await list('support_messages','id,author,body,created_at',req,{ticket_id:'eq.'+ticket.id,internal:'eq.false',order:'created_at.asc'}));
  await limit(u,'support-reply',20,3600);need(ticket.status!=='closed',409,'This ticket is closed. Create a new request.');
  const body=text(b.body,6000);need(body.length>0,400,'Enter a message.');
  await supa('/rest/v1/loox_support_messages',{method:'POST',body:JSON.stringify({ticket_id:ticket.id,author:u.id,body,internal:false})});
  return res.json({saved:true});
 }
 const identity=await controlIdentity(req,u);
 if(action==='identity'){method(req,'GET');return res.json({id:u.id,email:u.email,role:identity.role,permissions:identity.permissions,mfa:true});}
 if(action==='overview'){
  method(req,'GET');await permit(u,'overview');
  const end=req.query.end?new Date(req.query.end):new Date(),start=req.query.start?new Date(req.query.start):new Date(end.getTime()-30*86400000);
  need(Number.isFinite(+start)&&Number.isFinite(+end)&&end>start&&end-start<=366*86400000&&end<=new Date(Date.now()+86400000),400,'Choose a valid date range of up to 366 days.');
  return res.json(await rpc('control_overview',{p_start:start.toISOString(),p_end:end.toISOString()}));
 }
 if(action==='users'){method(req,'GET');await permit(u,'accounts_read');return res.json(await rpc('control_users',{p_search:text(req.query.search),p_page:page(req),p_plan:text(req.query.plan,40),p_status:text(req.query.status,20)}));}
 if(action==='user'){
  method(req,'GET');await permit(u,'accounts_read');need(uuid.test(req.query.id),400,'Invalid account ID.');
  const id=req.query.id,a=await supa('/auth/v1/admin/users/'+id);
  const [profile,wallet,subscriptions,restrictions,tickets]=await Promise.all([rows('profiles',{user_id:'eq.'+id,select:'name,created_at'}),rows('wallets',{user_id:'eq.'+id,select:'balance,debt'}),rows('subscriptions',{user_id:'eq.'+id,select:'plan,status,ends_at,provider_id'}),rows('account_restrictions',{user_id:'eq.'+id,select:'suspended,reason,updated_at'}),rows('support_tickets',{user_id:'eq.'+id,select:'id,subject,status,created_at',order:'created_at.desc',limit:'10'})]);
  return res.json({user:{id:a.id,email:a.email,created_at:a.created_at,last_sign_in_at:a.last_sign_in_at,email_confirmed:!!a.email_confirmed_at},profile:profile[0],wallet:wallet[0],subscriptions,restrictions:restrictions[0],tickets});
 }
 if(['subscriptions','payments','recharges','ledger','balance_changes','events','costs','refunds'].includes(action)){
  method(req,'GET');await permit(u,'finance');
  const tables={subscriptions:['subscriptions','provider_id,user_id,plan,status,ends_at,updated_at'],payments:['payments','reference,user_id,plan,amount_cents,currency,status,created_at'],recharges:['recharge_payments','reference,user_id,package_id,amount_cents,currency,status,credits,refunded_cents,created_at'],ledger:['credits','id,user_id,reason,amount,reference,created_at'],balance_changes:['balance_changes','id,user_id,transaction_id,balance_before,balance_after,debt_before,debt_after,created_at'],events:['payment_events','event_name,resource_reference,status,attempts,updated_at'],costs:['provider_costs','job_id,provider,model_id,estimated_millicents,actual_millicents,billing_reference,predict_seconds,created_at'],refunds:['invoice_refunds','reference,user_id,total_cents,granted_credits,refunded_cents,reversed_credits,updated_at']};
  const [table,select]=tables[action],filter={};if(req.query.user){need(uuid.test(req.query.user),400,'Invalid account ID.');filter.user_id='eq.'+req.query.user;}
  if(req.query.status)filter.status='eq.'+text(req.query.status,40);
  if(['subscriptions','events','refunds'].includes(action))filter.order='updated_at.desc';
  return res.json(await list(table,select,req,filter));
 }
 if(action==='tickets'){method(req,'GET');await permit(u,'support');return res.json(await list('support_tickets','*',req,req.query.status?{status:'eq.'+text(req.query.status,30)}:{}));}
 if(action==='ticket'){
  method(req,'GET');await permit(u,'support');need(uuid.test(req.query.id),400,'Invalid ticket ID.');
  const [ticket]=await rows('support_tickets',{id:'eq.'+req.query.id,select:'*',limit:'1'});need(ticket,404,'Ticket not found.');
  return res.json({ticket,...await list('support_messages','*',req,{ticket_id:'eq.'+ticket.id,order:'created_at.asc'})});
 }
 if(action==='mutate'){
  method(req,'POST');const b=json(req);mutation(b);if(b.action==='template_save'){const d=b.data;need(d&&typeof d.title==='string'&&typeof d.prompt==='string'&&Array.isArray(d.styles)&&d.styles.length<=30&&d.styles.every(x=>typeof x==='string'&&x.length<=70)&&typeof d.active==='boolean'&&JSON.stringify(d).length<16000&&/^[a-z0-9-]{3,80}$/.test(b.target),400,'Invalid template.');if(d.media_provider==='r2')need(typeof d.media_key==='string'&&d.media_key.startsWith('public/templates/')&&!d.media_key.includes('..'),400,'Invalid template media.');}need(['restriction','model_price','model_pause','ticket_update','ticket_reply','template_save','taxonomy'].includes(b.action),400,'Unsupported management action.');
  const result=await rpc('control_mutate',{p_actor:u.id,p_action:b.action,p_target:text(b.target,200),p_reason:b.reason,p_request:b.requestId,p_data:b.data||{}});return res.json(result);
 }
 if(action==='templates'){
  method(req,'GET');await permit(u,'templates');const [result,categories,styles]=await Promise.all([list('template_catalog','*',req,req.query.search?{title:'ilike.*'+text(req.query.search).replace(/[*,%_()]/g,'')+'*'}:{}),rows('template_categories',{select:'name,sort_order',order:'sort_order,name'}),rows('template_styles',{select:'name,sort_order',order:'sort_order,name'})]);
  result.items=await Promise.all(result.items.map(async t=>({...t,preview:await mediaURL({storage_provider:t.media_provider,object_key:t.media_key,thumbnail_key:t.thumbnail_key,result_path:t.media_path,legacy_bucket:'loox-templates'},{thumbnail:true,expires:300}).catch(()=>null)})));
  return res.json({...result,categories,styles});
 }
 if(action==='models'){
  method(req,'GET');await permit(u,'models');const [operations,workers,controls,circuits]=await Promise.all([rows('operations',{select:'id,cost,max_millicents,minimum_plan',order:'id'}),rows('local_worker_health',{select:'modes,last_seen',limit:'1'}),rows('cost_controls',{select:'*'}),rows('model_circuits',{select:'operation,paused_until,reason',paused_until:'gt.'+new Date().toISOString()})]);
  return res.json({operations,image:imageCatalog(operations),video:videoCatalog(operations),worker:workers[0]||null,controls:controls[0],circuits});
 }
 if(action==='notifications'){
  method(req,'GET');await permit(u,'security');const result=await list('security_alerts','id,category,severity,service,occurrences,created_at,last_seen,sent_at',req),reads=await rows('admin_reads',{user_id:'eq.'+u.id,select:'alert_id',limit:'1000'});const seen=new Set(reads.map(x=>x.alert_id));return res.json({...result,items:result.items.map(x=>({...x,read:seen.has(x.id)}))});
 }
 if(action==='notification_read'){method(req,'POST');await permit(u,'security');const b=json(req);need(uuid.test(b.id),400,'Invalid notification ID.');await supa('/rest/v1/loox_admin_reads',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({user_id:u.id,alert_id:b.id})});return res.json({saved:true});}
 if(action==='audit'){method(req,'GET');await permit(u,'security');return res.json(await list('admin_audit','id,actor,action,target,reason,detail,created_at',req));}
 if(action==='settings'){
  method(req,'GET');await permit(u,'security');const [roles,plans,limits,health]=await Promise.all([rows('admin_roles',{select:'user_id,role,permissions,active'}),rows('plans',{select:'id,price_cents,credits,cadence'}),rows('provider_limits',{select:'*'}),rpc('billing_health',{})]);
  return res.json({roles,plans,limits,health,flags:flags(),integrations:{r2:r2Ready(),lemonCredentials:!!(env.LEMON_API_KEY&&env.LEMON_STORE_ID&&env.LEMON_WEBHOOK_SECRET),lemonMode:env.LEMON_MODE||'unconfigured',email:!!(env.RESEND_API_KEY&&env.SECURITY_ALERT_EMAIL&&env.SECURITY_ALERT_FROM),workerSigning:env.LOOX_WORKER_SIGNED_REQUESTS_REQUIRED==='true'},recovery:'Keep your verified authenticator backed up securely. Lost-factor recovery requires the owner to verify identity through the Supabase project console; this application cannot bypass MFA.',profit:'Operating profit and bank payouts are unavailable until all provider invoices, fees and operating expenses are reconciled.'});
 }
 need(false,404,'Unknown Control Center action.');
});
