import {rows,need} from './core.js';
import {activeSubscription,planTier} from './plans.js';
// Financial state is required. Unrelated history failures must not block the wallet.
export async function accountOverview(user,{read=rows}={}){
 const own={user_id:'eq.'+user.id},recent={...own,order:'created_at.desc',limit:'40'},unavailable=[];
 const optional=async(name,filters)=>{try{return await read(name,filters);}catch{unavailable.push(name);return [];}};
 const [profiles,wallets,credits,jobs,subscriptions,payments,lifetime]=await Promise.all([
  read('profiles',{...own,select:'name,created_at,deleting'}),read('wallets',{...own,select:'balance,debt'}),
  optional('credits',{...recent,select:'reason,amount,created_at,reference'}),
  optional('jobs',{...recent,select:'id,operation,cost,state,created_at'}),
  read('subscriptions',{...own,order:'updated_at.desc',select:'plan,status,ends_at'}),
  optional('payments',{...recent,select:'plan,amount_cents,currency,status,created_at,reference'}),
  read('payments',{...own,plan:'eq.lifetime',status:'eq.paid',select:'reference',limit:'1'})
 ]);
 need(wallets[0]&&Number.isSafeInteger(wallets[0].balance),503,'Credit balance is temporarily unavailable. Please retry.');
 const active=subscriptions.filter(s=>activeSubscription(s)),tier=active.some(s=>s.plan.startsWith('business'))?'business':active.some(s=>planTier(s.plan)==='pro')?'pro':active.some(s=>planTier(s.plan)==='creator')?'creator':'basic';
 return {profile:profiles[0],wallet:wallets[0],credits,jobs,subscriptions,payments,plan:lifetime.length?'pro':tier,legacyLifetime:Boolean(lifetime.length),unavailable};
}
