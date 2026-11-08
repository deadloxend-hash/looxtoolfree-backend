// Authenticated, thread-owned R2 chat attachments. Text chat logic is unchanged.
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {authenticate,account,json,limit,method,need,rows,supa,uuid,Problem} from './core.js';
import {deleteR2Object,presignR2Object,putR2Object,r2Ready} from './r2.js';
import {makeThumbnail,thumbnailKey,userKey} from './media-store.js';

async function ownThread(user,id){
 need(typeof id==='string'&&uuid.test(id),400,'Invalid conversation ID.');
 const [thread]=await rows('chat_threads',{id:'eq.'+id,user_id:'eq.'+user.id,select:'id',limit:'1'});
 need(thread,404,'Conversation not found.');
 return thread;
}
async function imageBytes(source){
 need(typeof source==='string'&&source.length<=2_800_000,413,'Image exceeds the chat attachment limit.');
 const match=/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/]+=*)$/i.exec(source);
 need(match,415,'Upload a PNG, JPG or WebP image.');
 const input=Buffer.from(match[2],'base64');
 need(input.length>0&&input.length<=2_097_152,413,'Chat images must be under 2 MB.');
 try{
  const image=sharp(input,{limitInputPixels:9_000_000,failOn:'warning'});
  const info=await image.metadata();
  need(['png','jpeg','webp'].includes(info.format)&&(info.pages||1)===1,415,'Unsupported chat image.');
  const bytes=await image.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true})
   .webp({quality:80,effort:4}).toBuffer();
  need(bytes.length>0&&bytes.length<=2_000_000,413,'Processed chat image exceeds 2 MB.');
  return bytes;
 }catch(e){if(e.status)throw e;throw new Problem(415,'Chat image could not be decoded.');}
}
export async function chatAttachmentAction(req,res,action){
 const user=await authenticate(req);
 await account(user);
 need(r2Ready(),503,'Chat attachments are temporarily unavailable.');
 if(action==='list'){
  method(req,'GET');await limit(user,'chat_media_list',60,60);
  const thread_id=String(req.query.thread_id||'');
  await ownThread(user,thread_id);
  const records=await rows('chat_attachments',{user_id:'eq.'+user.id,thread_id:'eq.'+thread_id,
   select:'id,created_at,media_type,object_key,thumbnail_key',order:'created_at.asc',limit:'100'});
  return res.json({items:records.map(row=>({
   id:row.id,created_at:row.created_at,media_type:row.media_type,
   url:presignR2Object('GET',row.object_key,{expires:300}),
   thumbnail_url:presignR2Object('GET',row.thumbnail_key||row.object_key,{expires:300})
  }))});
 }
 method(req,'POST');const body=json(req);
 if(action==='upload'){
  await limit(user,'chat_media_upload',12,3600);
  const thread_id=String(body.thread_id||'');
  await ownThread(user,thread_id);
  const bytes=await imageBytes(body.image),id=randomUUID();
  const key=userKey(user.id,'chat',id,'image/webp'),thumb=thumbnailKey(user.id,id);
  await putR2Object(key,bytes,'image/webp');
  await putR2Object(thumb,await makeThumbnail(bytes),'image/webp');
  try{
   await supa('/rest/v1/loox_chat_attachments',{
    method:'POST',body:JSON.stringify({id,user_id:user.id,thread_id,
     object_key:key,thumbnail_key:thumb,media_type:'image/webp',media_bytes:bytes.length})
   });
  }catch(e){
   await deleteR2Object(thumb).catch(()=>{});
   await deleteR2Object(key).catch(()=>{});
   throw e;
  }
  return res.status(201).json({id,media_type:'image/webp',url:presignR2Object('GET',key,{expires:300}),
   thumbnail_url:presignR2Object('GET',thumb,{expires:300})});
 }
 if(action==='delete'){
  await limit(user,'chat_media_delete',30,3600);
  need(typeof body.id==='string'&&uuid.test(body.id),400,'Invalid attachment ID.');
  const [found]=await rows('chat_attachments',{id:'eq.'+body.id,user_id:'eq.'+user.id,
   select:'id,object_key,thumbnail_key',limit:'1'});
  need(found,404,'Chat attachment not found.');
  need(found.object_key.startsWith('users/'+user.id+'/chat/'),403,'Invalid attachment ownership.');
  await supa('/rest/v1/loox_chat_attachments?'+new URLSearchParams({id:'eq.'+body.id,user_id:'eq.'+user.id}),
   {method:'DELETE'});
  await deleteR2Object(found.object_key);
  if(found.thumbnail_key?.startsWith('users/'+user.id+'/thumbnails/'))
   await deleteR2Object(found.thumbnail_key);
  return res.json({deleted:true});
 }
 throw new Problem(404,'Unknown chat attachment action.');
}
