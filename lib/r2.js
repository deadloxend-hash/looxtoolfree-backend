// Cloudflare R2 private S3-compatible storage adapter for LOOX AI.
// Disabled unless all server-side secrets are present. No public bucket access.
import {createHash,createHmac} from 'node:crypto';
import {env,need,Problem} from './core.js';

// Credentials are a bucket-scoped R2 API token; its token ID and hashed value
// are kept only in the production server environment.

const hex=value=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const esc=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const keyPath=key=>key.split('/').map(esc).join('/');
export const r2Ready=()=>['LOOX_R2_ACCOUNT_ID','LOOX_R2_BUCKET','LOOX_R2_ACCESS_KEY_ID','LOOX_R2_SECRET_ACCESS_KEY'].every(k=>typeof env[k]==='string'&&env[k].length>0);
function settings(){
 need(r2Ready(),503,'R2 media storage has not been configured. Existing Supabase media is unchanged.');
 need(/^[a-f0-9]{32}$/.test(env.LOOX_R2_ACCOUNT_ID),503,'R2 account configuration is invalid.');
 need(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.LOOX_R2_BUCKET),503,'R2 bucket configuration is invalid.');
 return {host:env.LOOX_R2_ACCOUNT_ID+'.r2.cloudflarestorage.com',
  bucket:env.LOOX_R2_BUCKET,access:env.LOOX_R2_ACCESS_KEY_ID,secret:env.LOOX_R2_SECRET_ACCESS_KEY};
}
function validatedKey(key){
 need(typeof key==='string'&&key.length<=450
  &&/^(?:users\/[a-f0-9-]{36}\/(?:generations|thumbnails|inputs|chat|community)\/[a-z0-9][a-z0-9._-]{1,159}|public\/(?:templates|avatars|community)\/[a-z0-9][a-z0-9/_-]{1,300})$/i.test(key)
  &&!key.includes('..')&&!key.includes('//')&&!key.endsWith('/'),400,'Invalid private R2 object key.');
 return key;
}
async function signed(method,key,{body=null,type='',timeout=30000}={}){
 const {host,bucket,access,secret}=settings();
 const pathname='/'+esc(bucket)+'/'+keyPath(validatedKey(key));
 const now=new Date(),stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,'');
 const date=stamp.slice(0,8),scope=date+'/auto/s3/aws4_request';
 const payloadHash=hex(body||Buffer.alloc(0));
 const headers={'host':host,'x-amz-date':stamp,'x-amz-content-sha256':payloadHash};
 if(type)headers['content-type']=type;
 const names=Object.keys(headers).sort(),signedHeaders=names.join(';');
 const canonicalHeaders=names.map(k=>k+':'+headers[k].trim()+'\n').join('');
 const canonical=[method,pathname,'',canonicalHeaders,signedHeaders,payloadHash].join('\n');
 const stringToSign=['AWS4-HMAC-SHA256',stamp,scope,hex(canonical)].join('\n');
 const signingKey=hmac(hmac(hmac(hmac(Buffer.from('AWS4'+secret),date),'auto'),'s3'),'aws4_request');
 const signature=createHmac('sha256',signingKey).update(stringToSign).digest('hex');
 headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signedHeaders+', Signature='+signature;
 const response=await fetch('https://'+host+pathname,{method,headers,body:body||undefined,
  signal:AbortSignal.timeout(timeout),redirect:'error'});
 return response;
}
export async function putR2Object(key,bytes,contentType){
 need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=40_000_000,413,'Media file exceeds the 40 MB R2 upload limit.');
 need(['image/webp','image/png','image/jpeg','video/mp4'].includes(contentType),415,'Unsupported media content type.');
 const result=await signed('PUT',key,{body:bytes,type:contentType});
 need(result.ok,503,'Media storage was unable to save this file.');
 const etag=result.headers.get('etag')?.replaceAll('"','')||null;
 return {provider:'r2',path:key,etag};
}
export async function getR2Object(key){
 const result=await signed('GET',key);
 if(result.status===404)throw new Problem(404,'This media file was not found.');
 need(result.ok,503,'Media storage is temporarily unavailable.');
 const length=Number(result.headers.get('content-length')||0);
 need(length<=40_000_000,413,'Media file is too large to retrieve.');
 const bytes=Buffer.from(await result.arrayBuffer());
 need(bytes.length<=40_000_000,413,'Media file is too large to retrieve.');
 return {bytes,type:result.headers.get('content-type')||'application/octet-stream'};
}
export async function headR2Object(key){
 const result=await signed('HEAD',key);
 if(result.status===404)return null;
 need(result.ok,503,'Media storage is temporarily unavailable.');
 return {bytes:Number(result.headers.get('content-length')||0),type:result.headers.get('content-type')||'application/octet-stream',etag:result.headers.get('etag')?.replaceAll('"','')||null};
}
export async function deleteR2Object(key){
 const result=await signed('DELETE',key);
 need(result.ok||result.status===404,503,'Media storage could not delete this file.');
 return true;
}
export function presignR2Object(method,key,{expires=300,contentType=''}={}){
 const {host,bucket,access,secret}=settings();
 need(['GET','PUT'].includes(method),400,'Unsupported signed media operation.');
 need(Number.isInteger(expires)&&expires>=30&&expires<=7200,400,'Invalid media link lifetime.');
 const pathname='/'+esc(bucket)+'/'+keyPath(validatedKey(key));
 const now=new Date(),stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,'');
 const date=stamp.slice(0,8),scope=date+'/auto/s3/aws4_request';
 const headers={host};if(contentType)headers['content-type']=contentType;
 const names=Object.keys(headers).sort(),signedHeaders=names.join(';');
 const query=new URLSearchParams({'X-Amz-Algorithm':'AWS4-HMAC-SHA256','X-Amz-Credential':access+'/'+scope,'X-Amz-Date':stamp,'X-Amz-Expires':String(expires),'X-Amz-SignedHeaders':signedHeaders});
 const canonicalQuery=[...query].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>esc(k)+'='+esc(v)).join('&');
 const canonicalHeaders=names.map(k=>k+':'+headers[k]+'\n').join('');
 const canonical=[method,pathname,canonicalQuery,canonicalHeaders,signedHeaders,'UNSIGNED-PAYLOAD'].join('\n');
 const stringToSign=['AWS4-HMAC-SHA256',stamp,scope,hex(canonical)].join('\n');
 const signingKey=hmac(hmac(hmac(hmac(Buffer.from('AWS4'+secret),date),'auto'),'s3'),'aws4_request');
 query.set('X-Amz-Signature',createHmac('sha256',signingKey).update(stringToSign).digest('hex'));
 return 'https://'+host+pathname+'?'+query.toString();
}
