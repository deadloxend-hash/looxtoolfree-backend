import {rpc} from './core.js';
export const planTier=id=>(id?.startsWith('pro')||id?.startsWith('business'))?'pro':id?.startsWith('creator')?'creator':'basic';
export function activeSubscription(s,now=Date.now()){
 return ['active','on_trial'].includes(s.status)&&(!s.ends_at||Date.parse(s.ends_at)>now)||s.status==='cancelled'&&Date.parse(s.ends_at)>now;
}
export async function memberTier(id){return rpc('member_tier',{p_user:id});}
