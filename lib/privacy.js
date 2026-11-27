import {randomBytes,createHash} from 'node:crypto';
import {env,need,uuid,rpc,supa} from './core.js';
import {verifyExportPassword,collectAccountRecords} from './account-export.js';
import {presignR2Object} from './r2.js';
const profileOrigin='https://loox-profile-api.looxai-studio.workers.dev/v1/';
export async function securitySummary(user,claims,{call=rpc}={}){
 need(uuid.test(claims?.session_id||''),401,'Please sign in again to manage privacy and security.');
 const result=await call('security_summary',{p_user:user.id,p_session:claims.session_id});
 if(user.app_metadata?.loox_template_admin===true&&result?.deletion)result.deletion.requires_support=true;
 return result;
}
export function ownMediaKey(user,key){
 return typeof key==='string'&&!key.includes('..')&&!key.includes('\\')&&(key.startsWith('users/'+user+'/')||key.startsWith('public/avatars/'+user+'/'));
}
export async function completeDataExport(user,password,claims,authorization,{verify=verifyExportPassword,collect=collectAccountRecords,call=rpc,request=fetch,sign=presignR2Object,storage=supa}={}){
 const started=Date.now();
 const security=await securitySummary(user,claims,{call});
 await verify(user,password,claims,{purpose:'export'});
 const token=randomBytes(32).toString('base64url');
 await call('issue_privacy_proof',{p_user:user.id,p_session:claims.session_id,p_hash:createHash('sha256').update(token).digest('hex')});
 const response=await request(profileOrigin+'account-export',{
  method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({proof:token}),
  credentials:'omit',redirect:'error',signal:AbortSignal.timeout(45000)
 });
 need(response.ok,response.status===413?413:503,response.status===413?'Request a larger export through Support.':'Creator export is temporarily unavailable. No partial export was returned.');
 const cloud=await response.json();need(cloud&&cloud.records&&Array.isArray(cloud.media),503,'Creator export is unavailable.');
 const data=await collect(user),media=[];
 const linksExpireAt=new Date(Date.now()+299000).toISOString();
 for(const item of cloud.media){
  need(Date.now()-started<50000,413,'Request a larger export through Support.');
  need(ownMediaKey(user.id,item.key),503,'Export media ownership verification failed.');
  const filename=item.key.split('/').pop();
  media.push({provider:'r2',key:item.key,bytes:Number(item.bytes)||0,content_type:item.content_type,uploaded_at:item.uploaded_at,
   url:sign('GET',item.key,{expires:300,downloadName:filename})});
 }
 let after='';
 for(let page=0;;page++){
  need(page<100,413,'Request a larger storage export through Support.');
  const files=await call('account_storage_inventory',{p_user:user.id,p_after:after,p_limit:500});
  if(!files.length)break;
  for(const file of files){
   need(Date.now()-started<50000,413,'Request a larger export through Support.');
   need(['loox-results','loox-avatars'].includes(file.bucket_id)&&file.name.startsWith(user.id+'/')&&!file.name.includes('..'),503,'Storage ownership verification failed.');
   const path=file.name.split('/').map(encodeURIComponent).join('/');
   const signed=await storage('/storage/v1/object/sign/'+file.bucket_id+'/'+path,{method:'POST',body:JSON.stringify({expiresIn:300})});
   need(typeof signed?.signedURL==='string',503,'A private file could not be exported.');
   const url=new URL(env.SUPABASE_URL+'/storage/v1'+signed.signedURL);url.searchParams.set('download',file.name.split('/').pop());
   media.push({provider:'supabase',bucket:file.bucket_id,key:file.name,bytes:Number(file.bytes)||0,content_type:file.content_type,url:url.href});
  }
  const last=files.at(-1),next=last.bucket_id+'/'+last.name;
  need(next>after,503,'Storage pagination is unavailable.');after=next;
  need(media.length<=10000,413,'Request a larger media export through Support.');
 }
 Object.assign(data,{format:'loox-personal-data-v2',security,cloudflare:cloud.records,media,media_links_expire_at:linksExpireAt,
  scope:'Account, billing, conversations, generation sessions, creator/social records and private media inventory across Supabase and Cloudflare. Download media in archive parts using Settings.',
  exclusions:['Platform secrets, fraud fingerprints and internal security/moderation notes','Original media bytes are downloaded separately in archive parts; the JSON contains short-lived download links'],
  full_export:'Download this JSON and every media part for your content. Large accounts exceeding the automatic export limits need a verified support export.'});
 need(Buffer.byteLength(JSON.stringify(data))<=4000000,413,'This account needs a larger export through Support. No partial export was returned.');
 return data;
}
export async function deletePrivateAccount(user,password,claims,authorization,{verify=verifyExportPassword,summary=securitySummary,call=rpc,request=fetch,storage=supa}={}){
 const security=await summary(user,claims);await verify(user,password,claims,{purpose:'delete'});
 need(typeof security?.deletion?.requires_support==='boolean',503,'Deletion eligibility could not be verified. No data was deleted.');
 need(!security.deletion.requires_support&&user.app_metadata?.loox_template_admin!==true,409,'Administrator accounts, billing history and shared platform assets require a verified support deletion review. No data was deleted.');
 await call('begin_delete',{p_user:user.id});
 const token=randomBytes(32).toString('base64url');
 await call('issue_privacy_proof',{p_user:user.id,p_session:claims.session_id,p_hash:createHash('sha256').update(token).digest('hex')});
 const cloud=await request(profileOrigin+'account-delete',{method:'DELETE',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({proof:token}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(45000)});
 need(cloud.ok,503,'Creator cleanup is unavailable. Your account is retained; retry deletion to continue.');
 const result=await cloud.json();need(result.complete===true,409,'Private media cleanup is in progress. Retry deletion to continue safely.');
 for(let page=0;page<20;page++){
  const files=await call('account_storage_inventory',{p_user:user.id,p_after:'',p_limit:100});
  if(!files.length){
   const revoked=await request(env.SUPABASE_URL+'/auth/v1/logout?scope=global',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(10000)});
   need(revoked.ok,503,'Session revocation could not finish. Your account is retained; retry deletion.');
   await storage('/auth/v1/admin/users/'+user.id,{method:'DELETE'});
   return {deleted:true};
  }
  need(files.every(f=>['loox-results','loox-avatars'].includes(f.bucket_id)&&f.name.startsWith(user.id+'/')&&!f.name.includes('..')),503,'Storage ownership verification failed.');
  for(const bucket of ['loox-results','loox-avatars']){
   const names=files.filter(f=>f.bucket_id===bucket).map(f=>f.name);
   need(names.every(name=>name.startsWith(user.id+'/')&&!name.includes('..')),503,'Storage ownership verification failed.');
   if(names.length)await storage('/storage/v1/object/'+bucket,{method:'DELETE',body:JSON.stringify({prefixes:names})});
  }
 }
 need(false,409,'Legacy file cleanup is in progress. Retry deletion to continue safely.');
}
