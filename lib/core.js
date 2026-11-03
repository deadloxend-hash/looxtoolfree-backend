import { createHmac, timingSafeEqual } from 'node:crypto';

export const env = process.env;
export const TERMS = '2026-11';
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function need(ok, status, message) { if (!ok) throw new Problem(status, message); }
export function ready(...keys) { return keys.every(key => Boolean(env[key]?.trim())); }
export function equal(a,b) {
  const x=Buffer.from(String(a)), y=Buffer.from(String(b));
  return x.length===y.length && timingSafeEqual(x,y);
}
export function mac(value, key=env.LOOX_IDENTITY_SECRET) { return createHmac('sha256',key).update(value).digest('hex'); }
export const authReady=()=>ready('SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','LOOX_IDENTITY_SECRET');
export const aiReady=()=>authReady() && ready('LOOX_WORKER_SECRET') && Number.isSafeInteger(Number(env.LOOX_DAILY_BUDGET_MILLICENTS)) && Number(env.LOOX_DAILY_BUDGET_MILLICENTS)>0;
export const billingReady=()=>authReady() && ready('LEMON_API_KEY','LEMON_STORE_ID','LEMON_PRO_VARIANT','LEMON_LIFETIME_VARIANT','LEMON_WEBHOOK_SECRET') && ['live','test'].includes(env.LEMON_MODE);

const messages = {
 insufficient_credits:[402,'You need more AI credits for this tool.'],rate_limited:[429,'Too many requests in a short time. Try again in a minute.'],daily_generation_limit:[429,'Daily generation limit reached. Your allowance resets at 00:00 UTC.'],jobs_in_progress:[429,'Two AI jobs are already running. Wait for one to finish before starting another.'],
 budget_limit:[503,'Today’s AI processing budget has been reached.'],idempotency_conflict:[409,'This request ID already belongs to a different edit.'],
 cancel_first:[409,'Cancel your subscription in the billing portal first.'],jobs_pending:[409,'Wait for pending AI jobs to finish first.'],
 account_unavailable:[409,'Account deletion is in progress.']
};
export async function supa(path, options={}) {
 const response=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+path,{
   ...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
   'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000),redirect:'error'});
 const body=await response.text(); let data;
 try {data=body?JSON.parse(body):null;} catch {data=null;}
 if(!response.ok){const known=messages[data?.message];if(known)throw new Problem(...known);throw new Problem(503,'Account service is temporarily unavailable.');}
 return data;
}
export const rpc=(name,body)=>supa('/rest/v1/rpc/loox_'+name,{method:'POST',body:JSON.stringify(body)});
export function rows(table, filters) {
 return supa('/rest/v1/loox_'+table+'?'+new URLSearchParams(filters));
}
export async function authenticate(req) {
 need(authReady(),503,'Account setup is pending.');
 const bearer=req.headers.authorization||'';
 need(/^Bearer [\w.-]{16,8192}$/.test(bearer),401,'Sign in to continue.');
 const r=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:bearer},signal:AbortSignal.timeout(10000)});
 need(r.ok,r.status>=500?503:401,'Please sign in again.');
 const u=await r.json();
 need(uuid.test(u.id)&&u.email_confirmed_at && u.email && !u.is_anonymous,403,'Verify your email before using AI tools.');
 return u;
}
export async function account(u) {
 const meta=u.user_metadata||{};
 need(meta.loox_terms===TERMS,403,'Accept the current LOOX terms in Account Settings.');
 await rpc('account',{p_user:u.id,p_name:String(meta.full_name||'LOOX member'),p_terms:TERMS,p_fingerprint:mac('bonus:'+u.email.trim().toLowerCase())});
}
export const limit=(u,group,count,seconds=60)=>rpc('rate',{p_key:group+':'+u.id,p_limit:count,p_seconds:seconds});
export function handler(fn,{cors=true}={}) {
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try {
   if(cors){
    const origin=req.headers.origin, approved=(env.LOOX_ORIGINS||'https://deadloxend-hash.github.io').split(',').map(s=>s.trim());
    need(!origin||approved.includes(origin),403,'Origin is not allowed.');
    if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
    if(req.method==='OPTIONS')return res.status(204).end();
   }
   await fn(req,res);
  }catch(e){res.status(e instanceof Problem?e.status:503).json({error:e instanceof Problem?e.message:'Service temporarily unavailable. Please retry.'});}
 };
}
export function json(req) {
 need(/^application\/json\b/i.test(req.headers['content-type']||''),415,'Send JSON.');
 try{return typeof req.body==='string'?JSON.parse(req.body):req.body||{};}catch{throw new Problem(400,'Invalid JSON.');}
}
export function method(req,m) {need(req.method===m,405,'Method not allowed.');}
export async function raw(req,max=512000){
 const chunks=[];let size=0;
 for await(const b of req){size+=b.length;need(size<=max,413,'Payload too large.');chunks.push(b);}
 return Buffer.concat(chunks);
}
export const frontURL=()=> 'https://deadloxend-hash.github.io/looxtoolsfree/';
