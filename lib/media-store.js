import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {env,mac,need,Problem,supa} from './core.js';
import {deleteR2Object,getR2Object,headR2Object,presignR2Object,putR2Object,r2Ready} from './r2.js';

const types={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeId=value=>{need(/^[a-f0-9-]{36}$/i.test(value||''),400,'Invalid media identifier.');return value.toLowerCase();};
export const userKey=(user,category,id,type,suffix='')=>{
 need(['generations','inputs','chat','community'].includes(category),400,'Invalid media category.');
 need(Object.hasOwn(types,type),415,'Unsupported media type.');
 need(!suffix||/^-[a-z0-9_-]{1,40}$/.test(suffix),400,'Invalid media suffix.');
 return `users/${safeId(user)}/${category}/${safeId(id)}${suffix}.${types[type]}`;
};
export const thumbnailKey=(user,id)=>`users/${safeId(user)}/thumbnails/${safeId(id)}.webp`;
export function workerInputURL(key,expires=7200){
 need(/^users\/[a-f0-9-]{36}\/inputs\/[a-z0-9._-]+$/i.test(key),400,'Invalid worker input key.');
 // The Windows worker accepts the private R2 S3 host directly. The older
 // constructed /storage/v1/object/sign URL was not a real backend route.
 return presignR2Object('GET',key,{expires});
}

export async function inspectMedia(bytes,declared,{max=40_000_000}={}){
 need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=max,413,'Media file exceeds the supported limit.');
 if(declared==='video/mp4'){
  need(bytes.length>=12&&bytes.subarray(4,8).toString('ascii')==='ftyp',415,'Video output is not a valid MP4 file.');
  return {type:declared,bytes:bytes.length,sha256:sha(bytes)};
 }
 need(['image/png','image/jpeg','image/webp'].includes(declared),415,'Unsupported image type.');
 try{
  const meta=await sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning'}).metadata();
  const actual={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'}[meta.format];
  need(actual===declared&&(meta.pages||1)===1,415,'Image content does not match its declared type.');
  return {type:actual,bytes:bytes.length,sha256:sha(bytes),width:meta.width,height:meta.height};
 }catch(error){if(error instanceof Problem)throw error;throw new Problem(415,'Media file could not be decoded.');}
}
export async function makeThumbnail(bytes){
 return sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning'}).rotate().resize({width:480,height:480,fit:'inside',withoutEnlargement:true}).webp({quality:76,effort:4}).toBuffer();
}
export async function saveGeneratedMedia({user,id,bytes,type}){
 need(r2Ready(),503,'R2 media storage is not configured.');
 const info=await inspectMedia(bytes,type),key=userKey(user,'generations',id,type);
 await putR2Object(key,bytes,type);
 const stored=await headR2Object(key);need(stored&&stored.bytes===bytes.length,503,'Media upload verification failed.');
 let thumb=null;
 if(type!=='video/mp4'){
  const preview=await makeThumbnail(bytes);thumb=thumbnailKey(user,id);
  await putR2Object(thumb,preview,'image/webp');
  const checked=await headR2Object(thumb);need(checked&&checked.bytes===preview.length,503,'Thumbnail verification failed.');
 }
 return {...info,provider:'r2',key,thumbnail_key:thumb};
}
export async function verifyUploadedMedia({user,id,type,expectedSha=null}){
 const key=userKey(user,'generations',id,type),head=await headR2Object(key);
 need(head&&head.bytes>0&&head.bytes<=(type==='video/mp4'?40_000_000:16_000_000),422,'Uploaded media is missing or exceeds its limit.');
 need(head.type===type||head.type==='application/octet-stream',415,'Uploaded media has an unexpected content type.');
 const object=await getR2Object(key),info=await inspectMedia(object.bytes,type,{max:type==='video/mp4'?40_000_000:16_000_000});
 if(expectedSha)need(/^[a-f0-9]{64}$/.test(expectedSha)&&expectedSha===info.sha256,422,'Uploaded media checksum did not match.');
 let thumbnail_key=null;
 if(type!=='video/mp4'){
  const preview=await makeThumbnail(object.bytes);thumbnail_key=thumbnailKey(user,id);await putR2Object(thumbnail_key,preview,'image/webp');
 }
 return {...info,provider:'r2',key,thumbnail_key};
}
export async function mediaURL(job,{thumbnail=false,expires=300}={}){
 if(job.storage_provider==='r2'&&job.object_key){
  const key=thumbnail&&job.thumbnail_key?job.thumbnail_key:job.object_key;
  return presignR2Object('GET',key,{expires});
 }
 const path=job.result_path||job.media_path;
 if(!path)return null;
 const bucket=job.legacy_bucket||'loox-results';
 const signed=await supa('/storage/v1/object/sign/'+bucket+'/'+path,{method:'POST',body:JSON.stringify({expiresIn:expires})});
 return signed?.signedURL?env.SUPABASE_URL+'/storage/v1'+signed.signedURL:null;
}
export async function removeJobMedia(job){
 if(job.storage_provider==='r2'&&job.object_key){
  await deleteR2Object(job.object_key);if(job.thumbnail_key)await deleteR2Object(job.thumbnail_key);
 }else if(job.result_path){await supa('/storage/v1/object/loox-results/'+job.result_path,{method:'DELETE'});}
}
