import {rows,authReady} from '../../lib/core.js';
import {flags,creditPolicy,draftPackages} from '../config/billing.js';
export async function billingCatalog(){
 let packages=draftPackages.map(p=>({...p,approved:false})),available=false;
 if(authReady())try{packages=await rows('recharge_packages',{select:'id,name,credits,price_cents,approved',order:'price_cents.asc'});available=true;}catch{}
 return {...flags(),packages,creditPolicy,catalogAvailable:available,currency:'USD',message:'Secure checkout coming soon'};
}
