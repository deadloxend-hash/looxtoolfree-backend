import {need,limit} from '../../lib/core.js';
// Called only with a user returned by Supabase's authenticated /auth/v1/user lookup.
export async function requireFinancialAdmin(req,u){
 await limit(u,'financial-admin',20,60);
 need(u.app_metadata?.loox_template_admin===true,403,'Administrator access required.');
 const claims=req.looxAuthClaims;
 need(claims?.sub===u.id&&claims?.aal==='aal2'&&claims.exp>Date.now()/1000,403,'Verify an authenticator code in Account Settings to access financial administration.');
}
