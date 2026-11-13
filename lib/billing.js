import {env,rows,rpc,need,equal,mac,uuid,billingReady,frontURL} from './core.js';

const variant=plan=>({business:env.LEMON_BUSINESS_VARIANT,business_yearly:env.LEMON_BUSINESS_YEARLY_VARIANT,creator:env.LEMON_CREATOR_VARIANT,creator_yearly:env.LEMON_CREATOR_YEARLY_VARIANT,pro:env.LEMON_PRO_VARIANT,pro_yearly:env.LEMON_PRO_YEARLY_VARIANT,lifetime:env.LEMON_LIFETIME_VARIANT})[plan];
const purchasable=['business','business_yearly','creator','creator_yearly','pro','pro_yearly'];
export const checkoutPlans=()=>purchasable.filter(plan=>Boolean(variant(plan)));
const binding=(id,plan)=>mac(['checkout',env.LEMON_MODE,env.LEMON_STORE_ID,variant(plan),id,plan].join('/'));
async function lemon(path, options={}) {
 const r=await fetch('https://api.lemonsqueezy.com/v1/'+path,{...options,headers:{'Content-Type':'application/vnd.api+json',Accept:'application/vnd.api+json',Authorization:'Bearer '+env.LEMON_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
 need(r.ok,503,'Billing provider is temporarily unavailable.');return (await r.json()).data;
}
function hosted(url){
 const parsed=new URL(url);
 need(parsed.protocol==='https:'&&parsed.hostname.endsWith('.lemonsqueezy.com'),503,'Billing URL unavailable.');
 return parsed.href;
}
export async function checkout(u,plan) {
 need(billingReady(),503,'Checkout is awaiting merchant configuration.');
 need(purchasable.includes(plan),400,'Choose a monthly or yearly paid plan.');
 need(variant(plan),503,'This plan is awaiting merchant configuration.');
 const v=variant(plan), [price]=await rows('plans',{id:'eq.'+plan,select:'price_cents'});
 const existing=await rows('subscriptions',{user_id:'eq.'+u.id,status:'not.in.(expired)',limit:'1'});
 need(!existing.length,409,'You already have this plan. See your account for billing details.');
 const item=await lemon('variants/'+encodeURIComponent(v)), a=item.attributes;
 need(a.price===price.price_cents && a.is_subscription===true && !a.pay_what_you_want && !a.has_free_trial && a.interval===(plan.endsWith('_yearly')?'year':'month')&&a.interval_count===1,503,'Store pricing needs to be synchronized.');
 const relate=(type,id)=>({data:{type,id:String(id)}});
 const data={type:'checkouts',relationships:{store:relate('stores',env.LEMON_STORE_ID),variant:relate('variants',v)},attributes:{
  test_mode:env.LEMON_MODE==='test',expires_at:new Date(Date.now()+15*60000).toISOString(),
  product_options:{enabled_variants:[Number(v)],redirect_url:frontURL()+'account.html?payment=return'},
  checkout_options:{discount:false},checkout_data:{email:u.email,custom:{loox_user:u.id,loox_plan:plan,loox_binding:binding(u.id,plan)}}}};
 return {url:hosted((await lemon('checkouts',{method:'POST',body:JSON.stringify({data})})).attributes.url)};
}
export async function portal(u){
 need(billingReady(),503,'Billing setup is pending.');
 const [s]=await rows('subscriptions',{user_id:'eq.'+u.id,order:'updated_at.desc',limit:'1'});
 need(s,404,'No subscription to manage.');
 return {url:hosted((await lemon('subscriptions/'+s.provider_id)).attributes.urls.customer_portal)};
}
export async function billingEvent(payload) {
 const {meta,data}=payload, a=data.attributes, event=meta.event_name;
 if(String(a.store_id)!==env.LEMON_STORE_ID||a.test_mode!==(env.LEMON_MODE==='test'))return;
 const isInvoice=data.type==='subscription-invoices',isSub=data.type==='subscriptions';
 const subId=isInvoice?String(a.subscription_id):String(data.id);
 let plan;
 if(isSub)plan=purchasable.find(p=>variant(p)&&String(a.variant_id)===String(variant(p)));
 else if(isInvoice){const [previous]=await rows('subscriptions',{provider_id:'eq.'+subId,select:'plan'});need(previous,503,'Waiting for subscription registration.');plan=previous.plan;}
 else plan='lifetime';
 if(!plan)return;
 // New lifetime checkouts are blocked. Keep historical refunds functioning.
 if(plan==='lifetime'&&event==='order_created')return;
 if(!isInvoice && String(isSub?a.variant_id:a.first_order_item?.variant_id)!==variant(plan))return;
 const custom=meta.custom_data;
 let user=custom?.loox_user;
 if(custom?.loox_binding){
  need(uuid.test(user)&&custom.loox_plan===plan&&equal(custom.loox_binding,binding(user,plan)),400,'Invalid checkout binding.');
 }else if(isInvoice||isSub){
  const [prev]=await rows('subscriptions',{provider_id:'eq.'+subId,select:'user_id'});
  need(prev,503,'Waiting for subscription registration.');user=prev.user_id;
 }else return;
 const profile=await rows('profiles',{user_id:'eq.'+user,select:'deleting'});
 if(!profile.length)return;
 const args={p_user:user,p_plan:plan,p_ref:null,p_status:a.status,p_amount:0,p_currency:'USD',p_subscription:null,p_updated:a.updated_at,p_ends:null};
 if(isSub && ['subscription_created','subscription_updated','subscription_cancelled','subscription_expired','subscription_resumed','subscription_paused','subscription_unpaused'].includes(event)){
  return rpc('billing',{...args,p_subscription:subId,p_ends:a.ends_at});
 }
 if(isInvoice && !['initial','renewal'].includes(a.billing_reason))return;
 if(isInvoice && !['subscription_payment_success','subscription_payment_failed','subscription_payment_refunded','subscription_payment_recovered'].includes(event))return;
 if(!isInvoice && !(data.type==='orders'&&['order_created','order_refunded'].includes(event)))return;
 const refunded=a.refunded===true||a.status==='refunded';
 if(!refunded && !['paid','failed','void'].includes(a.status))return;
 if(a.currency!=='USD'||!Number.isInteger(a.total)||a.total<=0)return;
 if(!refunded&&a.status==='paid'){
  const [configured]=await rows('plans',{id:'eq.'+plan,select:'price_cents'});
  need(configured&&a.subtotal===configured.price_cents,400,'Invoice amount does not match this plan.');
 }
 return rpc('billing',{...args,p_ref:data.type+'/'+data.id,p_amount:a.total,p_status:refunded?'refunded':a.status==='paid'?'paid':'failed'});
}
