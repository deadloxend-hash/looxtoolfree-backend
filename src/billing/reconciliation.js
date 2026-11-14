import {env,rows,supa} from '../../lib/core.js';
import {lemon} from '../../lib/billing.js';
import {incident} from '../notifications/security-alerts.js';
// Read-only provider comparisons. Never silently repair a financial discrepancy.
export async function reconcileProvider(admin){
 if(!env.LEMON_API_KEY||!env.LEMON_STORE_ID)return {configured:false,checked:0,mismatches:[],complete:false,message:'Configure the merchant account before provider reconciliation.'};
 const [plans,topups]=await Promise.all([rows('payments',{select:'reference,status,amount_cents,currency',order:'created_at.desc',limit:'10'}),rows('recharge_payments',{select:'reference,status,amount_cents,currency,refunded_cents',order:'created_at.desc',limit:'10'})]);
 const mismatches=[];let checked=0;
 for(const p of [...plans,...topups]){
  if(!/^(orders|subscription-invoices)\/\d+$/.test(p.reference)){mismatches.push({reference:p.reference,reason:'Unsupported provider reference'});continue;}
  try{
   const remote=await lemon(p.reference),a=remote.attributes;
   const status=a.refunded||a.status==='refunded'?'refunded':a.status;
   if(String(a.store_id)!==env.LEMON_STORE_ID||a.test_mode!==(env.LEMON_MODE==='test')||a.currency!==p.currency||a.total!==p.amount_cents||status!==p.status)mismatches.push({reference:p.reference,reason:'Provider amount, status, store or mode differs'});
   checked++;
  }catch{mismatches.push({reference:p.reference,reason:'Provider verification unavailable'});}
 }
 await supa('/rest/v1/loox_financial_audit',{method:'POST',body:JSON.stringify({admin_id:admin.id,action:'provider_reconciliation checked='+checked+' mismatches='+mismatches.length})});
 if(mismatches.length)await incident('reconciliation');
 return {configured:true,checked,mismatches,complete:plans.length<10&&topups.length<10,message:'Read-only comparison of the latest 10 records of each payment type. No balances were modified.'};
}
