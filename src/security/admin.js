import {need,limit} from '../../lib/core.js';
// The user and claims must come from authenticate(), which verifies with Supabase.
export async function requireAdmin(req,u,group='admin',count=60){
 await limit(u,group,count,60);
 need(u.app_metadata?.loox_template_admin===true,403,'Administrator access required.');
 const claims=req.looxAuthClaims;
 need(claims?.sub===u.id&&claims?.aal==='aal2'&&claims.exp>Date.now()/1000,403,'Verify an authenticator code in Account Settings to access administration.');
}
export const requireFinancialAdmin=(req,u)=>requireAdmin(req,u,'financial-admin',20);
