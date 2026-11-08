// Staged, non-destructive migration of existing private Supabase media to R2.
// Not invoked by a public endpoint. Call only from an authenticated admin job.
// Source objects are never deleted here.
import {createHash} from 'node:crypto';
import {env,need} from './core.js';
import {getR2Object,putR2Object} from './r2.js';

const allowed=/^([a-f0-9-]{36})\/(?:[a-z0-9/_-]*\/)?([a-f0-9-]{36})\.(png|webp|jpg|mp4)$/i;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function copySupabaseMediaToR2(sourcePath,{category='generations'}={}){
 need(['generations','community','templates','chat','avatars','sessions'].includes(category),400,'Invalid media category.');
 const match=allowed.exec(sourcePath||'');
 need(match&&!sourcePath.includes('..')&&!sourcePath.includes('//'),400,'Invalid legacy media path.');
 const [,owner,id,extension]=match;
 const target=owner+'/'+category+'/'+id+'.'+extension.toLowerCase();
 const origin=new URL(env.SUPABASE_URL);
 const encoded=sourcePath.split('/').map(encodeURIComponent).join('/');
 const url=origin.origin+'/storage/v1/object/loox-results/'+encoded;
 const response=await fetch(url,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},redirect:'error',signal:AbortSignal.timeout(60000)});
 need(response.ok,503,'Unable to read original Supabase media; original remains unchanged.');
 const length=Number(response.headers.get('content-length')||0);
 need(length<=40_000_000,413,'Original exceeds supported migration size.');
 const bytes=Buffer.from(await response.arrayBuffer());
 need(bytes.length>0&&bytes.length<=40_000_000,413,'Original exceeds supported migration size.');
 const type=extension.toLowerCase()==='mp4'?'video/mp4':extension.toLowerCase()==='png'?'image/png':extension.toLowerCase()==='webp'?'image/webp':'image/jpeg';
 await putR2Object(target,bytes,type);
 const verified=await getR2Object(target);
 need(hash(bytes)===hash(verified.bytes),503,'R2 verification failed; original remains unchanged.');
 return {source:sourcePath,target,bytes:bytes.length,sha256:hash(bytes),verified:true};
}
