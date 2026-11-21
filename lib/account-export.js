import {env,need,rows} from './core.js';
// Explicit columns only: never export authentication tokens, provider credentials,
// worker state, abuse fingerprints, or another account's records.
export const exportSections=Object.freeze({
 profiles:'name,terms_version,created_at',wallets:'balance,debt',
 credits:'id,reason,amount,reference,created_at',
 jobs:'id,operation,cost,state,prompt,created_at,storage_provider,media_type,media_bytes',
 subscriptions:'plan,status,ends_at',payments:'plan,amount_cents,currency,status,created_at,reference',
 chat_threads:'id,model,title,created_at,updated_at',
 media_sessions:'id,title,created_at,updated_at',
 media_entries:'id,session_id,media_type,prompt,model_id,model_name,ratio,settings,created_at'
});
export async function verifyExportPassword(user,password,claims,{request=fetch}={}){
 need(typeof password==='string'&&password.length>0&&password.length<=128,400,'Confirm your password.');
 const response=await request(env.SUPABASE_URL+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email:user.email,password}),signal:AbortSignal.timeout(12000),redirect:'error'
 });
 need(response.ok,403,'Password verification failed.');
 const verified=await response.json();
 need(typeof verified.access_token==='string',403,'Password verification failed.');
 try{
  need(verified.user?.id===user.id,403,'Password verification failed.');
  const factors=[...(user.factors||[]),...(verified.user.factors||[])];
  need(!factors.some(f=>f.status==='verified')||claims?.aal==='aal2',403,'Sign in with your authenticator before downloading account records.');
 }finally{
  // Reauthentication must not leave an extra refreshable session behind.
  const revoked=await request(env.SUPABASE_URL+'/auth/v1/logout?scope=local',{
   method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+verified.access_token},
   signal:AbortSignal.timeout(10000),redirect:'error'
  });
  need(revoked.ok,503,'Verification cleanup is unavailable. Please retry later.');
 }
}
export async function collectAccountRecords(user,{read=rows,maxRows=10000}={}){
 const records={};let size=0,requests=0;
 async function collect(table,filter,select){
  const items=[];
  for(let offset=0;;){
   need(++requests<=100,413,'This account needs a larger export. Request it through support.');
   const order=table==='profiles'?'user_id.asc':table==='subscriptions'?'provider_id.asc':table==='payments'?'reference.asc':'id.asc';
   const batch=await read(table,{...filter,select,limit:'500',offset:String(offset),order});
   need(Array.isArray(batch),503,'Account records are temporarily unavailable.');
   if(!batch.length)break;
   items.push(...batch);offset+=batch.length;
   size+=Buffer.byteLength(JSON.stringify(batch));
   need(items.length<=maxRows&&size<=3500000,413,'This account needs a larger export. Request a full export through support.');
   // Continue until an empty page: server-imposed page caps must not truncate exports.
  }
  return items;
 }
 for(const [table,select] of Object.entries(exportSections)){
  // Wallet has no created_at column. All other exported groups have one.
  const readSection=table==='wallets'?await read(table,{user_id:'eq.'+user.id,select,limit:'1'}):await collect(table,{user_id:'eq.'+user.id},select);
  records[table]=readSection;
 }
 const threads=records.chat_threads;
 records.chat_messages=[];
 for(const thread of threads){
  need(/^[a-f0-9-]{36}$/i.test(thread.id),503,'A conversation identifier is invalid.');
  const messages=await collect('chat_messages',{thread_id:'eq.'+thread.id},'id,thread_id,role,content,created_at');
  records.chat_messages.push(...messages);
  need(records.chat_messages.length<=maxRows,413,'Request a larger conversation export through support.');
 }
 return {
  format:'loox-account-records-v1',exported_at:new Date().toISOString(),
  account:{id:user.id,email:user.email,email_verified:Boolean(user.email_confirmed_at)},records,
  scope:'Account, wallet, credit ledger, job metadata, subscriptions, payments, conversations and generation sessions retained in Supabase.',
  exclusions:['Original uploaded/generated media bytes','Cloudflare D1 creator and social data','Some support, security, audit and legacy social records'],
  collection_note:'Records are collected page by page. Concurrent changes may appear in a later export.',
  full_export:'Request a complete cross-service export through LOOX Support. This download does not delete or change account data.'
 };
}
