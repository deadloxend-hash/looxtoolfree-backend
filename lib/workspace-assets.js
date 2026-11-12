// Private, durable reference library. Bytes stay in R2; the database stores ownership only.
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {authenticate,account,json,limit,method,need,rows,supa,uuid} from './core.js';
import {r2Ready,putR2Object,presignR2Object,deleteR2Object} from './r2.js';
import {makeThumbnail,thumbnailKey,userKey} from './media-store.js';
export async function normalizeAsset(source){
 const match=typeof source==='string'&&source.length<=3_200_040&&/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/]+=*)$/i.exec(source);
 need(match,415,'Choose a JPG, PNG or WebP under 2.4 MB.');const raw=Buffer.from(match[2],'base64');need(raw.length>0&&raw.length<=2_400_000,413,'Image exceeds 2.4 MB.');
 try{const image=sharp(raw,{limitInputPixels:4_000_000,failOn:'warning'}),meta=await image.metadata();need(['png','jpeg','webp'].includes(meta.format)&&(meta.pages||1)===1,415,'Choose a still image.');
 const {data,info}=await image.rotate().webp({quality:94,effort:4}).toBuffer({resolveWithObject:true});need(data.length<=2_400_000,413,'Processed image exceeds 2.4 MB.');return {bytes:data,width:info.width,height:info.height,sha256:createHash('sha256').update(data).digest('hex')};
 }catch(e){if(e.status)throw e;need(false,415,'Image is damaged or exceeds four megapixels.');}
}
export function createAssetService(deps={}){
 const dbRows=deps.rows||rows,db=deps.supa||supa,put=deps.put||putR2Object,sign=deps.sign||presignR2Object,remove=deps.remove||deleteR2Object;
 const present=row=>({id:row.id,name:row.name,width:row.width,height:row.height,bytes:row.media_bytes,created_at:row.created_at,url:sign('GET',row.object_key,{expires:300}),thumbnail_url:sign('GET',row.thumbnail_key,{expires:300})});
 async function own(user,id){need(uuid.test(id||''),400,'Invalid asset ID.');const [row]=await dbRows('user_assets',{id:'eq.'+id,user_id:'eq.'+user.id,select:'*',limit:'1'});need(row,404,'Asset not found.');need(row.object_key.startsWith('users/'+user.id+'/inputs/'),403,'Invalid asset ownership.');return row;}
 return {
 async list(user,{offset=0,query='',archived=false}={}){need(Number.isInteger(offset)&&offset>=0&&offset<=1000,400,'Invalid asset page.');const records=await dbRows('user_assets',{user_id:'eq.'+user.id,deleted_at:archived?'not.is.null':'is.null',select:'*',order:'created_at.desc',limit:'21',offset:String(offset),...(query?{name:'ilike.*'+query.slice(0,80).replace(/[\\%_*]/g,'')+'*'}:{})});return {items:records.slice(0,20).map(present),has_more:records.length>20};},
 async upload(user,body){need(body.permission===true,400,'Confirm that you own or have permission to use this image.');const image=await normalizeAsset(body.image);const [duplicate]=await dbRows('user_assets',{user_id:'eq.'+user.id,sha256:'eq.'+image.sha256,select:'*',limit:'1'});
 if(duplicate){if(duplicate.deleted_at)await db('/rest/v1/loox_user_assets?'+new URLSearchParams({id:'eq.'+duplicate.id,user_id:'eq.'+user.id}),{method:'PATCH',body:JSON.stringify({deleted_at:null})});return {...present(duplicate),reused:true};}
 const count=await dbRows('user_assets',{user_id:'eq.'+user.id,select:'id',limit:'101'});need(count.length<100,429,'Your reference library is full (100 images).');const id=randomUUID(),key=userKey(user.id,'inputs',id,'image/webp','-asset'),thumb=thumbnailKey(user.id,id),name=String(body.name||'Reference image').trim().slice(0,100)||'Reference image';const record={id,user_id:user.id,name,sha256:image.sha256,object_key:key,thumbnail_key:thumb,media_type:'image/webp',media_bytes:image.bytes.length,width:image.width,height:image.height};
 try{await put(key,image.bytes,'image/webp');await put(thumb,await makeThumbnail(image.bytes),'image/webp');const data=await db('/rest/v1/loox_user_assets',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(record)});return {...present(data[0]),reused:false};}catch(e){await Promise.allSettled([remove(key),remove(thumb)]);throw e;}
 },
 async purge(user,id){const row=await own(user,id);need(row.deleted_at,409,'Remove the asset before deleting it permanently.');await remove(row.object_key);await remove(row.thumbnail_key);await db('/rest/v1/loox_user_assets?'+new URLSearchParams({id:'eq.'+row.id,user_id:'eq.'+user.id}),{method:'DELETE'});return {deleted:true};},
 async archive(user,id,restore=false){const row=await own(user,id);await db('/rest/v1/loox_user_assets?'+new URLSearchParams({id:'eq.'+row.id,user_id:'eq.'+user.id}),{method:'PATCH',body:JSON.stringify({deleted_at:restore?null:new Date().toISOString()})});return {archived:!restore,restored:restore};}
 };
}
export async function workspaceAssetAction(req,res,action){const user=await authenticate(req);await account(user);need(r2Ready(),503,'Reference library storage is unavailable.');const service=createAssetService();
 if(action==='list'){method(req,'GET');await limit(user,'asset_list',60);return res.json(await service.list(user,{offset:Number(req.query.offset||0),query:String(req.query.q||''),archived:req.query.archived==='1'}));}
 method(req,'POST');const body=json(req);if(action==='upload'){await limit(user,'asset_upload',12,3600);return res.status(201).json(await service.upload(user,body));}
 if(action==='purge'){await limit(user,'asset_edit',30);return res.json(await service.purge(user,body.id));}
 need(action==='archive'||action==='restore',404,'Unknown asset action.');await limit(user,'asset_edit',30);return res.json(await service.archive(user,body.id,action==='restore'));
}
