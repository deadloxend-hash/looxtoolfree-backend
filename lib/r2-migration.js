// Resumable, non-destructive Supabase Storage -> private Cloudflare R2 copy.
// Source objects are never deleted by this module.
import {createHash} from 'node:crypto';
import {env,need,rows,supa} from './core.js';
import {getR2Object,headR2Object,putR2Object} from './r2.js';
import {makeThumbnail} from './media-store.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bucket=/^loox-(results|avatars|templates)$/;
const path=/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,430}\.(png|webp|jpg|jpeg|mp4)$/;
const mimeFor=(source,type)=>type&&['image/png','image/jpeg','image/webp','video/mp4'].includes(type)?type:
 source.toLowerCase().endsWith('.mp4')?'video/mp4':source.toLowerCase().endsWith('.webp')?'image/webp':source.toLowerCase().match(/\.jpe?g$/)?'image/jpeg':'image/png';

async function sourceBytes(sourceBucket,sourcePath){
 need(bucket.test(sourceBucket)&&path.test(sourcePath)&&!sourcePath.includes('..')&&!sourcePath.includes('//'),400,'Invalid legacy media object.');
 const encoded=sourcePath.split('/').map(encodeURIComponent).join('/');
 const response=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/storage/v1/object/'+sourceBucket+'/'+encoded,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},redirect:'error',signal:AbortSignal.timeout(60000)});
 need(response.ok,503,'Unable to read original Supabase media; original remains unchanged.');
 const declared=response.headers.get('content-type')||'';
 const length=Number(response.headers.get('content-length')||0);need(!length||length<=40_000_000,413,'Original exceeds supported migration size.');
 const bytes=Buffer.from(await response.arrayBuffer());need(bytes.length>0&&bytes.length<=40_000_000,413,'Original exceeds supported migration size.');
 return {bytes,type:mimeFor(sourcePath,declared)};
}
export async function copySupabaseMediaToR2(sourcePath,{sourceBucket='loox-results',target,category='generations'}={}){
 need(typeof target==='string'&&target.length<450,400,'Invalid R2 migration target.');
 const source=await sourceBytes(sourceBucket,sourcePath),checksum=hash(source.bytes);
 const existing=await headR2Object(target);
 if(!existing||existing.bytes!==source.bytes.length)await putR2Object(target,source.bytes,source.type);
 const verified=await getR2Object(target);
 need(verified.bytes.length===source.bytes.length&&hash(verified.bytes)===checksum,503,'R2 verification failed; original remains unchanged.');
 let thumbnail=null;
 if(source.type!=='video/mp4'&&category!=='inputs'){
  const preview=await makeThumbnail(source.bytes),base=target.replace(/\.[^.]+$/,'.webp');
  thumbnail=target.includes('/generations/')?base.replace('/generations/','/thumbnails/'):base;
  if(thumbnail===target)thumbnail=target.replace(/\.[^.]+$/,'-thumb.webp');
  await putR2Object(thumbnail,preview,'image/webp');
  const thumbHead=await headR2Object(thumbnail);need(thumbHead?.bytes===preview.length,503,'R2 thumbnail verification failed.');
 }
 return {source:sourcePath,sourceBucket,target,thumbnail,type:source.type,bytes:source.bytes.length,sha256:checksum,verified:true};
}
export async function migrateMediaBatch(limit=8){
 const pending=await rows('media_migrations',{status:'in.(pending,failed)',order:'updated_at.asc',limit:String(Math.max(1,Math.min(limit,20)))}),results=[];
 for(const item of pending){
  await supa('/rest/v1/loox_media_migrations?id=eq.'+item.id,{method:'PATCH',body:JSON.stringify({status:'copying',attempts:item.attempts+1,error_code:null,updated_at:new Date().toISOString()})});
  try{
   const copied=await copySupabaseMediaToR2(item.source_path,{sourceBucket:item.source_bucket,target:item.target_key,category:item.category});
   if(item.source_bucket==='loox-results'&&item.category==='generations'){
    await supa('/rest/v1/loox_jobs?result_path=eq.'+encodeURIComponent(item.source_path),{method:'PATCH',body:JSON.stringify({storage_provider:'r2',object_key:copied.target,thumbnail_key:copied.thumbnail,media_type:copied.type,media_bytes:copied.bytes,media_sha256:copied.sha256})});
   }else if(item.source_bucket==='loox-avatars'){
    await supa('/rest/v1/loox_creator_profiles?avatar_path=eq.'+encodeURIComponent(item.source_path),{method:'PATCH',body:JSON.stringify({avatar_provider:'r2',avatar_key:copied.target,avatar_thumbnail_key:copied.thumbnail||copied.target})});
   }else if(item.source_bucket==='loox-templates'){
    await supa('/rest/v1/loox_template_catalog?media_path=eq.'+encodeURIComponent(item.source_path),{method:'PATCH',body:JSON.stringify({media_provider:'r2',media_key:copied.target,thumbnail_key:copied.thumbnail||copied.target})});
   }
   await supa('/rest/v1/loox_media_migrations?id=eq.'+item.id,{method:'PATCH',body:JSON.stringify({status:'verified',source_bytes:copied.bytes,target_bytes:copied.bytes,sha256:copied.sha256,updated_at:new Date().toISOString()})});results.push({id:item.id,status:'verified'});
  }catch(error){
   const code=String(error?.status||'copy_failed').slice(0,80);await supa('/rest/v1/loox_media_migrations?id=eq.'+item.id,{method:'PATCH',body:JSON.stringify({status:'failed',error_code:code,updated_at:new Date().toISOString()})});results.push({id:item.id,status:'failed',code});
  }
 }
 const inventory=await rows('media_migrations',{select:'status'}),counts={total:inventory.length,pending:0,copying:0,verified:0,failed:0};for(const row of inventory)counts[row.status]++;
 return {processed:results,inventory:counts};
}
