// Authenticated private R2 media gateway. Existing Supabase assets are unaffected.
// Small image uploads are server-validated; admin MP4 templates use scoped,
// expiring direct uploads with server-side final verification.
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {authenticate,account,method,json,need,limit} from './core.js';
import {r2Ready,putR2Object,getR2Object,headR2Object,presignR2Object,deleteR2Object} from './r2.js';
import {userKey,makeThumbnail,inspectMedia} from './media-store.js';

export async function r2MediaAction(req,res){
 const user=await authenticate(req);
 await account(user);
 need(r2Ready(),503,'R2 is not activated for LOOX AI. Existing media remains on Supabase.');
 if(req.method==='POST'){
  const body=json(req);
  // Admin-only original quality template images. Upload bytes directly to R2
  // so neither the browser nor this API silently reduces resolution or quality.
  if(body.purpose==='template_image_prepare'||body.purpose==='template_image_complete'){
   need(user.app_metadata?.loox_template_admin===true,403,'Administrator access required.');
   const types={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
   if(body.purpose==='template_image_prepare'){
    const type=String(body.content_type||'');
    need(Object.hasOwn(types,type),415,'Choose a PNG, JPEG or WebP image.');
    need(Number.isInteger(body.bytes)&&body.bytes>0&&body.bytes<=16_000_000,413,'Template image must be 16 MB or less.');
    const path='public/templates/'+user.id+'/'+randomUUID()+'.'+types[type];
    return res.json({provider:'r2',path,content_type:type,max_bytes:16_000_000,
     upload_url:presignR2Object('PUT',path,{expires:600,contentType:type})});
   }
   const path=String(body.path||''),sha256=String(body.sha256||'');
   need(/^public\/templates\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg|webp)$/i.test(path)&&
    path.startsWith('public/templates/'+user.id+'/'),403,'Template upload belongs to another account.');
   need(/^[a-f0-9]{64}$/.test(sha256),422,'Image upload checksum is missing.');
   const extension=path.split('.').pop().toLowerCase(),type={png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[extension];
   const head=await headR2Object(path);
   need(head&&head.bytes>0&&head.bytes<=16_000_000&&head.type===type,422,'Invalid template image size or type.');
   const object=await getR2Object(path),info=await inspectMedia(object.bytes,type,{max:16_000_000});
   need(info.sha256===sha256,422,'Template image checksum mismatch.');
   const thumbnail_key=path.replace(/\.(png|jpg|webp)$/i,'-thumb.webp');
   await putR2Object(thumbnail_key,await makeThumbnail(object.bytes),'image/webp');
   return res.json({provider:'r2',path,thumbnail_key,contentType:type,bytes:info.bytes,
    width:info.width,height:info.height});
  }
  if(body.purpose==='template_video_prepare'||body.purpose==='template_video_complete'){
   need(user.app_metadata?.loox_template_admin===true,403,'Administrator access required.');
   if(body.purpose==='template_video_prepare'){
    // Administrator template publishing is not subject to a per-hour upload count.
    // Authentication, admin role, file type/size and R2 path checks still apply.
    need(Number.isInteger(body.bytes)&&body.bytes>0&&body.bytes<=40_000_000,413,'MP4 template must be under 40 MB.');
    const path='public/templates/'+user.id+'/'+randomUUID()+'.mp4';
    return res.json({provider:'r2',path,content_type:'video/mp4',max_bytes:40_000_000,
     upload_url:presignR2Object('PUT',path,{expires:300,contentType:'video/mp4'})});
   }
   // No admin rate throttle on completion; ownership and SHA-256 verification remain mandatory.
   const path=String(body.path||''),sha256=String(body.sha256||'');
   need(path.startsWith('public/templates/'+user.id+'/')&&
    /^public\/templates\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.mp4$/i.test(path),403,'Template upload belongs to another account.');
   need(/^[a-f0-9]{64}$/.test(sha256),422,'Video upload checksum is missing.');
   const head=await headR2Object(path);
   need(head&&head.bytes>0&&head.bytes<=40_000_000&&head.type==='video/mp4',422,'Invalid template video size or type.');
   const video=await getR2Object(path),info=await inspectMedia(video.bytes,'video/mp4');
   need(info.sha256===sha256,422,'Video checksum mismatch.');
   return res.json({provider:'r2',path,thumbnail_key:null,contentType:'video/mp4',bytes:info.bytes});
  }
  const template=body.purpose==='template';
  need(!body.purpose||template,400,'Unsupported R2 upload purpose.');
  if(template){
   need(user.app_metadata?.loox_template_admin===true,403,'Administrator access required.');
   // Unlimited admin template count: retain strict image validation and file-size limits.
  }else{
   await limit(user,'r2_media_upload',5,3600);
  }
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
  const id=randomUUID();
  const path=template?'public/templates/'+id+'.webp':userKey(user.id,'community',id,'image/webp');
  await putR2Object(path,bytes,'image/webp');
  let thumbnail_key=null;
  if(template){
   thumbnail_key='public/templates/'+id+'-thumb.webp';
   await putR2Object(thumbnail_key,await makeThumbnail(bytes),'image/webp');
  }
  return res.status(201).json({provider:'r2',path,thumbnail_key,contentType:'image/webp',bytes:bytes.length});
 }
 method(req,'GET');
 await limit(user,'r2_media_read',90);
 const path=String(req.query.path||'');
 need(path.startsWith('users/'+user.id+'/community/'),403,'Private media belongs to another account.');
 const media=await getR2Object(path);
 res.setHeader('Content-Type',media.type);
 res.setHeader('Cache-Control','private, no-store');
 return res.status(200).end(media.bytes);
}
