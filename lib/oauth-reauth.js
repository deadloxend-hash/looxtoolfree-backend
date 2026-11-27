import {env,need,rpc,uuid,requireEnrolledMfa} from './core.js';
// Called only after authenticate() has validated the bearer with Supabase.
// Refreshing a token does not refresh the signed OAuth AMR timestamp.
export async function verifyRecentOAuth(user,claims,purpose,{call=rpc,now=Date.now()}={}){
 need(user.identities?.some(i=>i.provider==='google')||user.app_metadata?.providers?.includes('google'),403,'Verify your LOOX password or sign in again with your connected Google account.');
 need(claims?.sub===user.id&&uuid.test(claims?.session_id||''),403,'Sign in again with your connected Google account.');
 const seconds=now/1000;
 need(Array.isArray(claims.amr)&&claims.amr.some(a=>a.method==='oauth'&&Number.isFinite(a.timestamp)&&a.timestamp<=seconds+30&&a.timestamp>=seconds-300),403,'For this security action, verify your identity with Google again.');
 requireEnrolledMfa(user,claims);
 const consumed=await call('consume_recent_oauth',{p_user:user.id,p_session:claims.session_id,p_purpose:purpose});
 need(consumed===true,403,'This verification expired or was already used. Sign in with Google again.');
}
