import {reconcileProvider} from './reconciliation.js';
import {rows,supa,method,need,rpc} from '../../lib/core.js';
import {requireFinancialAdmin} from '../security/admin.js';
import {incident,deliverAlerts,emailReady} from '../notifications/security-alerts.js';
import {flags} from '../config/billing.js';
export async function financialAdmin(req,res,u){
 try{await requireFinancialAdmin(req,u);}catch(e){await incident('unauthorized_admin');throw e;}
 if(req.query.action==='billing_reconcile'){method(req,'POST');return res.json(await reconcileProvider(u));}
 if(req.query.action==='billing_alert_test'){
  method(req,'POST');await incident('simulated');return res.json(await deliverAlerts());
 }
 method(req,'GET');
 const [subscriptions,recharges,events,alerts,controls,changes]=await Promise.all([
 rows('payments',{select:'reference,plan,amount_cents,currency,status,created_at',order:'created_at.desc',limit:'100'}),
 rows('recharge_payments',{select:'reference,package_id,amount_cents,currency,status,refunded_cents,created_at',order:'created_at.desc',limit:'100'}),
 rows('payment_events',{select:'event_name,resource_reference,status,attempts,updated_at',order:'updated_at.desc',limit:'100'}),
 rows('security_alerts',{select:'category,severity,service,occurrences,created_at,sent_at',order:'created_at.desc',limit:'50'}),
 rows('cost_controls',{select:'*'}),rows('balance_changes',{select:'id,balance_before,balance_after,debt_before,debt_after,created_at',order:'created_at.desc',limit:'50'})]);
 await supa('/rest/v1/loox_financial_audit',{method:'POST',body:JSON.stringify({admin_id:u.id,action:'billing_dashboard_view'})});
 return res.json({health:await rpc('billing_health',{}),flags:flags(),payments:[...subscriptions,...recharges],events,alerts,controls,changes,emailConfigured:emailReady(),payouts:{status:'unverified',bank_received:null,estimated_fees:null,expected_payout:null,note:'Customer payment confirmation is separate from payout or bank receipt. Provider payout integration is not configured.'}});
}
