import {reconcileProvider} from './reconciliation.js';
import {rows,supa,method,need,rpc,json,limit,env} from '../../lib/core.js';
import {requireFinancialAdmin} from '../security/admin.js';
import {incident,deliverAlerts,emailReady} from '../notifications/security-alerts.js';
import {flags} from '../config/billing.js';
export async function financialAdmin(req,res,u){
 try{await requireFinancialAdmin(req,u);}catch(e){await incident('unauthorized_admin');throw e;}
 if(req.query.action==='billing_reconcile'){method(req,'POST');return res.json(await reconcileProvider(u,json(req).cursor));}
 if(req.query.action==='billing_cost_controls'){
  method(req,'POST');await limit(u,'cost-controls',6,3600);const b=json(req);
  need(Number.isSafeInteger(b.userDailyMillicents)&&b.userDailyMillicents>=1000&&b.userDailyMillicents<=10000000&&Number.isSafeInteger(b.operationMaxMillicents)&&b.operationMaxMillicents>=1000&&b.operationMaxMillicents<=10000000&&Array.isArray(b.disabledOperations)&&b.disabledOperations.length<=100&&b.disabledOperations.every(id=>typeof id==='string'&&/^[a-z0-9_]{1,80}$/.test(id)),400,'Choose valid spending limits and operation IDs.');
  const operations=await rows('operations',{select:'id'});need(b.disabledOperations.every(id=>operations.some(o=>o.id===id)),400,'Unknown generation operation.');
  await supa('/rest/v1/loox_cost_controls?id=eq.true',{method:'PATCH',body:JSON.stringify({user_daily_millicents:b.userDailyMillicents,operation_max_millicents:b.operationMaxMillicents,disabled_operations:[...new Set(b.disabledOperations)]})});
  await supa('/rest/v1/loox_financial_audit',{method:'POST',body:JSON.stringify({admin_id:u.id,action:'generation_cost_controls_updated'})});return res.json({saved:true});
 }
 if(req.query.action==='billing_alert_test'){
  method(req,'POST');await incident('simulated');return res.json(await deliverAlerts());
 }
 method(req,'GET');
 const [subscriptions,recharges,events,alerts,controls,changes,circuits]=await Promise.all([
 rows('payments',{select:'reference,plan,amount_cents,currency,status,created_at',order:'created_at.desc',limit:'100'}),
 rows('recharge_payments',{select:'reference,package_id,amount_cents,currency,status,refunded_cents,created_at',order:'created_at.desc',limit:'100'}),
 rows('payment_events',{select:'event_name,resource_reference,status,attempts,updated_at',order:'updated_at.desc',limit:'100'}),
 rows('security_alerts',{select:'category,severity,service,occurrences,created_at,sent_at',order:'created_at.desc',limit:'50'}),
 rows('cost_controls',{select:'*'}),rows('balance_changes',{select:'id,balance_before,balance_after,debt_before,debt_after,created_at',order:'created_at.desc',limit:'50'}),rows('model_circuits',{select:'operation,paused_until,reason,sample_jobs,failed_jobs,distinct_users',order:'updated_at.desc',limit:'100'})]);
 await supa('/rest/v1/loox_financial_audit',{method:'POST',body:JSON.stringify({admin_id:u.id,action:'billing_dashboard_view'})});
 const setup={paymentsEnabled:flags().paymentsEnabled,merchantConfigured:Boolean(env.LEMON_API_KEY&&env.LEMON_STORE_ID&&env.LEMON_WEBHOOK_SECRET),monthlyVariantsConfigured:['LEMON_CREATOR_VARIANT','LEMON_PRO_VARIANT','LEMON_BUSINESS_VARIANT'].every(k=>Boolean(env[k])),marginApproved:env.TOPUP_MARGIN_APPROVED==='true',alertRecipientConfigured:Boolean(env.SECURITY_ALERT_EMAIL),alertSenderConfigured:Boolean(env.SECURITY_ALERT_FROM),alertProviderConfigured:Boolean(env.RESEND_API_KEY),signedWorkerRequired:env.LOOX_WORKER_SIGNED_REQUESTS_REQUIRED==='true',backups:'Independent backup destination and recovery drill require verification'};
 return res.json({setup,providerConfigured:Boolean(env.LEMON_API_KEY&&env.LEMON_STORE_ID),health:await rpc('billing_health',{}),flags:flags(),payments:[...subscriptions,...recharges],events,alerts,controls,changes,circuits,emailConfigured:emailReady(),payouts:{status:'unverified',bank_received:null,estimated_fees:null,expected_payout:null,note:'Customer payment confirmation is separate from payout or bank receipt. Provider payout integration is not configured.'}});
}
