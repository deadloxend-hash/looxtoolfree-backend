import {env,need} from './core.js';
// Host and Origin are independent checks. Neither replaces account authorization.
export function trustedOrigin(value,configured=env.LOOX_ORIGINS||'https://deadloxend-hash.github.io'){
 if(value===undefined)return true; // Signed workers and webhooks do not send browser Origin.
 if(typeof value!=='string'||value==='null')return false;
 return configured.split(',').map(x=>x.trim()).some(entry=>{
  try{const url=new URL(entry);return url.protocol==='https:'&&!url.username&&!url.password&&url.origin===entry&&entry===value;}catch{return false;}
 });
}
export function validateHost(req,config=env){
 if(config.VERCEL_ENV!=='production')return;
 const actual=req.headers.host;
 const expected=new Set(['looxtoolfree-backend.vercel.app',config.VERCEL_URL,config.VERCEL_PROJECT_PRODUCTION_URL,...(config.LOOX_ALLOWED_HOSTS||'').split(',')].filter(Boolean).map(x=>x.trim().toLowerCase()));
 need(typeof actual==='string'&&/^[a-z0-9.-]+$/i.test(actual)&&expected.has(actual.toLowerCase()),403,'Request host is not allowed.');
}
