import {env,need} from './core.js';
import {verifyExportPassword} from './account-export.js';
// Supabase revokes refresh sessions server-side. Access JWTs last until expiry.
export async function revokeSessions(user,body,claims,authorization,{verify=verifyExportPassword,request=fetch}={}){
 need(['others','global'].includes(body.scope),400,'Choose other devices or all devices.');
 await verify(user,body.password,claims);
 const response=await request(env.SUPABASE_URL+'/auth/v1/logout?scope='+body.scope,{
  method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization},
  signal:AbortSignal.timeout(12000),redirect:'error'
 });
 need(response.ok,503,'Sessions could not be revoked. Please retry.');
 return {revoked:true,scope:body.scope,access_tokens_expire:true};
}
