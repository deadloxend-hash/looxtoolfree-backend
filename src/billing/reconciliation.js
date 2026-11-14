import {env,rows,supa,need,mac,equal} from '../../lib/core.js';
import {lemon} from '../../lib/billing.js';
import {incident} from '../notifications/security-alerts.js';
const PAGE=10;
function encodeCursor(admin,value){const body=Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+mac('reconciliation:'+admin.id+':'+body);}
function decodeCursor(admin,value){
 need(typeof value==='string'&&value.length<1800,400,'Invalid reconciliation cursor.');const [body,signature,...extra]=value.split('.');
 need(!extra.length&&signature&&equal(signature,mac('reconciliation:'+admin.id+':'+body)),400,'Invalid reconciliation cursor.');
 let c;try{c=JSON.parse(Buffer.from(body,'base64url'));}catch{need(false,400,'Invalid reconciliation cursor.');}
 need(c.v===1&&['payments','recharge_payments'].includes(c.table)&&typeof c.after==='string'&&/^(?:|(?:orders|subscription-invoices)\/\d+)$/.test(c.after)&&Number.isFinite(Date.parse(c.cutoff))&&c.expires>Date.now()&&c.expires<Date.now()+3601000&&Number.isSafeInteger(c.checked)&&c.checked>=0&&Number.isSafeInteger(c.mismatches)&&c.mismatches>=0,400,'Reconciliation cursor expired or invalid.');return c;
}
export async function reconcileProvider(admin,cursor){
 if(!env.LEMON_API_KEY||!env.LEMON_STORE_ID)return {configured:false,checked:0,totalChecked:0,mismatches:[],totalMismatches:0,complete:false,nextCursor:null,message:'Configure the merchant account before provider reconciliation.'};
 const c=cursor?decodeCursor(admin,cursor):{v:1,table:'payments',after:'',cutoff:new Date().toISOString(),expires:Date.now()+3600000,checked:0,mismatches:0};
 const records=await rows(c.table,{select:c.table==='payments'?'reference,status,amount_cents,currency':'reference,status,amount_cents,currency,refunded_cents',order:'reference.asc',limit:String(PAGE+1),created_at:'lte.'+c.cutoff,...(c.after?{reference:'gt.'+c.after}:{})});
 const page=records.slice(0,PAGE),references=page.filter(p=>/^subscription-invoices\/\d+$/.test(p.reference)).map(p=>p.reference);
 const refunds=references.length?await rows('invoice_refunds',{reference:'in.('+references.join(',')+')',select:'reference,refunded_cents'}):[];
 const mismatches=[];let checked=0;
 const compare=async p=>{
  if(!/^(orders|subscription-invoices)\/\d+$/.test(p.reference)){mismatches.push({reference:p.reference,reason:'Unsupported provider reference'});return;}
  try{
   const remote=await lemon(p.reference),a=remote.attributes,refund=Number(a.refunded_amount||0);
   const status=refund>=a.total&&refund>0?'refunded':refund>0?(c.table==='payments'?'partially_refunded':'refunded'):a.status;
   let mismatch=remote.type+'/'+remote.id!==p.reference||String(a.store_id)!==env.LEMON_STORE_ID||a.test_mode!==(env.LEMON_MODE==='test')||a.currency!==p.currency||a.total!==p.amount_cents||status!==p.status;
   if(c.table==='payments'&&p.reference.startsWith('subscription-invoices/'))mismatch||=Number(refunds.find(f=>f.reference===p.reference)?.refunded_cents||0)!==refund;
   if(c.table==='recharge_payments')mismatch||=Number(p.refunded_cents||0)!==refund;
   if(mismatch)mismatches.push({reference:p.reference,reason:'Provider amount, refund, status, store or mode differs'});
   checked++;
  }catch{mismatches.push({reference:p.reference,reason:'Provider verification unavailable'});}
 };
 // Bound each request to ten records and at most three provider calls in flight.
 for(let i=0;i<page.length;i+=3)await Promise.all(page.slice(i,i+3).map(compare));
 c.checked+=checked;c.mismatches+=mismatches.length;
 let complete=false;
 if(records.length>PAGE)c.after=page.at(-1).reference;
 else if(c.table==='payments'){c.table='recharge_payments';c.after='';}
 else complete=true;
 await supa('/rest/v1/loox_financial_audit',{method:'POST',body:JSON.stringify({admin_id:admin.id,action:'provider_reconciliation '+(complete?'complete':'page')+' checked='+c.checked+' mismatches='+c.mismatches})});
 if(mismatches.length)await incident('reconciliation');
 return {configured:true,checked,totalChecked:c.checked,mismatches,totalMismatches:c.mismatches,complete,verified:complete&&c.mismatches===0,nextCursor:complete?null:encodeCursor(admin,c),snapshot:c.cutoff,message:complete?'Finished all recorded payments in this snapshot. No balances were modified.':'More records remain. Continue using the signed cursor.'};
}
