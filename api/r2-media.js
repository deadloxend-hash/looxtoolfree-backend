// Authenticated private R2 media gateway. Existing Supabase assets are unaffected.
// This route deliberately supports small image uploads only until server-side
// video validation, retention controls and storage quotas are implemented.
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {authenticate,account,handler,method,json,need,limit,uuid} from '../lib/core.js';
import {r2Ready,putR2Object,getR2Object} from '../lib/r2.js';

export default handler(async (req,res)=>{
 const user=await authenticate(req);
 await account(user);
 need(r2Ready(),503,'R2 is not activated for LOOX AI. Existing media remains on Supabase.');
 if(req.method==='POST'){
  await limit(user,'r2_media_upload',5,3600);
  const body=json(req);
  need(typeof body.image==='string'&&body.image.length<=2_800_000,413,'Image exceeds upload limit.');
  const match=/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/]+=*)$/i.exec(body.image);
  need(match,400,'Choose a PNG, JPG or WebP image.');
  const input=Buffer.from(match[2],'base64');
  need(input.length>0&&input.length<=2_097_152,413,'Image exceeds 2 MB.');
  let bytes;
  try {
   const image=sharp(input,{limitInputPixels:9_000_000,failOn:'warning'});
   const meta=await image.metadata();
   need(['png','jpeg','webp'].includes(meta.format)&&(meta.pages||1)===1,400,'Unsupported image format.');
   bytes=await image.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true})
     .webp({quality:80,effort:4}).toBuffer();
  }catch(e){
   if(e.status)throw e;
   need(false,400,'Image could not be decoded.');
  }
  need(bytes.length<=2_000_000,413,'Processed image exceeds limit.');
  const path=user.id+'/community/'+randomUUID()+'.webp';
  await putR2Object(path,bytes,'image/webp');
  return res.status(201).json({provider:'r2',path,contentType:'image/webp',bytes:bytes.length});
 }
 method(req,'GET');
 await limit(user,'r2_media_read',90);
 const path=String(req.query.path||'');
 need(path.startsWith(user.id+'/'),403,'Private media belongs to another account.');
 const media=await getR2Object(path);
 res.setHeader('Content-Type',media.type);
 res.setHeader('Cache-Control','private, no-store');
 return res.status(200).end(media.bytes);
});
