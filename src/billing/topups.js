import {env,rows,rpc,need,mac,equal,uuid,billingReady,frontURL} from '../../lib/core.js';
import {lemon,hosted} from '../../lib/billing.js';
import {topupsEnabled} from '../config/billing.js';
const binding=(u,p)=>mac(['recharge',env.LEMON_MODE,env.LEMON_STORE_ID,p.variant_id,u,p.id,p.credits,p.price_cents].join('/'));
export async function rechargeCheckout(u,id){
 need(billingReady()&&topupsEnabled(),503,'Secure checkout coming soon');
 need(typeof id==='string'&&/^[a-z_]{1,40}$/.test(id),400,'Choose a recharge package.');
 const [p]=await rows('recharge_packages',{id:'eq.'+id,select:'*'});
 need(p?.approved&&/^\d+$/.test(p.variant_id),503,'This package is awaiting pricing approval.');
 const v=await lemon('variants/'+p.variant_id),a=v.attributes;
 need(a.price===p.price_cents&&!a.is_subscription&&!a.pay_what_you_want&&!a.has_free_trial,503,'Store pricing needs to be synchronized.');
 const relate=(type,id)=>({data:{type,id:String(id)}});
 const data={type:'checkouts',relationships:{store:relate('stores',env.LEMON_STORE_ID),variant:relate('variants',p.variant_id)},attributes:{test_mode:env.LEMON_MODE==='test',expires_at:new Date(Date.now()+900000).toISOString(),product_options:{enabled_variants:[Number(p.variant_id)],redirect_url:frontURL()+'account.html?payment=return'},checkout_options:{discount:false},checkout_data:{email:u.email,custom:{loox_user:u.id,loox_package:p.id,loox_credits:String(p.credits),loox_price:String(p.price_cents),loox_variant:p.variant_id,loox_binding:binding(u.id,p)}}}};
 return {url:hosted((await lemon('checkouts',{method:'POST',body:JSON.stringify({data})})).attributes.url)};
}
export async function rechargeEvent(payload){
 const c=payload.meta?.custom_data;if(!c?.loox_package)return false;
 need(payload.data?.type==='orders'&&/^\d+$/.test(String(payload.data.id)),400,'Invalid recharge event.');
 const p={id:c.loox_package,variant_id:c.loox_variant,credits:Number(c.loox_credits),price_cents:Number(c.loox_price)};
 need(uuid.test(c.loox_user)&&/^[a-z_]{1,40}$/.test(p.id)&&/^\d+$/.test(p.variant_id)&&Number.isSafeInteger(p.credits)&&p.credits>0&&Number.isSafeInteger(p.price_cents)&&p.price_cents>0&&equal(c.loox_binding,binding(c.loox_user,p)),400,'Invalid checkout binding.');
 // Re-fetch canonical provider state so delayed/replayed events cannot restore refunds.
 const current=await lemon('orders/'+payload.data.id),a=current.attributes;
 need(String(a.store_id)===env.LEMON_STORE_ID&&a.test_mode===(env.LEMON_MODE==='test')&&String(a.first_order_item?.variant_id)===p.variant_id&&a.currency==='USD'&&a.subtotal===p.price_cents&&a.first_order_item?.quantity===1,400,'Order does not match the recharge package.');
 if(!['paid','refunded','partial_refund'].includes(a.status)&&a.refunded!==true)return true;
 need(Number.isSafeInteger(a.total)&&a.total>0,400,'Invalid order total.');
 const refunded=a.status==='refunded'?a.total:Number(a.refunded_amount||0);
 need(Number.isSafeInteger(refunded)&&refunded>=0&&refunded<=a.total,400,'Invalid refund total.');
 await rpc('recharge_settle',{p_user:c.loox_user,p_reference:'orders/'+current.id,p_package:p.id,p_credits:p.credits,p_amount:a.total,p_refunded:refunded,p_chargeback:false});return true;
}
