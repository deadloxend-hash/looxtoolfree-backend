import {env,need,uuid,rows} from './core.js';
import {verifyExportPassword} from './account-export.js';
export async function manageAuthenticator(user,body,claims,authorization,{verify=verifyExportPassword,request=fetch,read=rows}={}){
 need(['enroll','remove'].includes(body.operation),400,'Choose an authenticator action.');
 if(body.operation==='remove')need(uuid.test(body.factorId||'')&&(user.factors||[]).some(f=>f.id===body.factorId&&f.factor_type==='totp'&&f.status==='verified')&&claims?.aal==='aal2',403,'Complete authenticator verification before removing your own factor.');
 if(body.operation==='remove'){const roles=await read('admin_roles',{user_id:'eq.'+user.id,active:'eq.true',select:'role',limit:'1'});need(user.app_metadata?.loox_template_admin!==true&&!roles.length,403,'Administrator authenticators require a verified recovery review.');}
 await verify(user,body.password,claims,{purpose:'mfa'});
 const remove=body.operation==='remove';
 const r=await request(env.SUPABASE_URL+'/auth/v1/factors'+(remove?'/'+body.factorId:''),{
  method:remove?'DELETE':'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json'},
  ...(remove?{}:{body:JSON.stringify({factor_type:'totp',friendly_name:'LOOX authenticator'})}),redirect:'error',signal:AbortSignal.timeout(15000)});
 need(r.ok,503,remove?'Authenticator removal could not finish. Please retry.':'Authenticator setup could not start. Please retry.');
 return remove?{removed:true}:r.json();
}
