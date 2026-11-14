import {requireFinancialAdmin} from '../src/security/admin.js';
import {viewChallenge,validateView} from './video-views.js';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {authenticate,env,method,json,need,limit,rows,supa,uuid,rpc} from './core.js';
import {putR2Object,deleteR2Object} from './r2.js';
import {mediaURL as signedMediaURL} from './media-store.js';

export async function communityAction(req,res,action){
 const u=await authenticate(req);
 if(action==='avatar'){
  method(req,'POST');await limit(u,'avatar',5,3600);const b=json(req);
  need(typeof b.image==='string'&&b.image.length<2_800_000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.image),400,'Choose a PNG, JPG or WebP under 2 MB.');
  const quota=await rpc('avatar_quota',{p_user:u.id});need(quota.allowed===true,413,'Profile picture storage limit reached. Contact support to review unused uploads.');
  const input=Buffer.from(b.image.split(',')[1],'base64');need(input.length<=2_097_152,413,'Profile picture must be under 2 MB.');
  let binary;try{const image=sharp(input,{limitInputPixels:25_000_000,animated:false});const info=await image.metadata();need(['png','jpeg','webp'].includes(info.format),400,'Unsupported profile picture.');binary=await image.rotate().resize(512,512,{fit:'cover'}).webp({quality:85}).toBuffer();}catch{need(false,400,'This picture could not be decoded. Choose another PNG, JPG or WebP.');}
  const id=randomUUID(),path=u.id+'/'+id+'.webp',key='public/avatars/'+u.id+'/'+id+'.webp';
  await putR2Object(key,binary,'image/webp');return res.json({path,provider:'r2',key});
 }

 if(action==='profile_media'){
  method(req,'GET');await limit(u,'profile_media_read',70);
  const kind=String(req.query.kind||'');need(['avatar','cover'].includes(kind),400,'Invalid profile image request.');
  const [p]=await rows('creator_profiles',{user_id:'eq.'+u.id,select:'avatar_path,avatar_provider,avatar_key,avatar_thumbnail_key,cover_key',limit:'1'});
  need(p,404,'Profile not found.');
  const item=kind==='cover'?{storage_provider:'r2',object_key:p.cover_key,thumbnail_key:p.cover_key}
    :{storage_provider:p.avatar_provider,object_key:p.avatar_key,thumbnail_key:p.avatar_thumbnail_key,result_path:p.avatar_path,legacy_bucket:'loox-avatars'};
  need(item.object_key||item.result_path,404,'Profile image unavailable.');
  const url=await signedMediaURL(item,{thumbnail:true,expires:300});
  need(url,404,'Profile image unavailable.');
  return res.json({url});
 }
 if(action==='cover'){
  method(req,'POST');await limit(u,'profile_cover',8,3600);const b=json(req);
  const [profile]=await rows('creator_profiles',{user_id:'eq.'+u.id,select:'user_id,cover_key',limit:'1'});
  need(profile,404,'Create your profile before adding a cover.');
  if(b.remove===true){
   await supa('/rest/v1/loox_creator_profiles?user_id=eq.'+u.id,{method:'PATCH',body:JSON.stringify({cover_key:null})});
   if(profile.cover_key)await deleteR2Object(profile.cover_key).catch(()=>{});
   return res.json({saved:true,cover_key:null});
  }
  need(typeof b.image==='string'&&b.image.length<=5_700_000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.image),400,'Choose a PNG, JPG or WebP cover image under 4 MB.');
  const input=Buffer.from(b.image.split(',')[1],'base64');
  need(input.length>0&&input.length<=4_000_000,413,'Cover image must be under 4 MB.');
  let bytes;
  try{
   const img=sharp(input,{limitInputPixels:30_000_000,animated:false,failOn:'warning'});
   const meta=await img.metadata();
   need(['png','jpeg','webp'].includes(meta.format)&&(meta.pages||1)===1,400,'Unsupported cover image.');
   bytes=await img.rotate().resize(1600,560,{fit:'cover',position:'attention'}).webp({quality:87,effort:4}).toBuffer();
  }catch(e){if(e.status)throw e;need(false,400,'Could not decode this cover image.');}
  const key='public/avatars/'+u.id+'/banner-'+randomUUID()+'.webp';
  await putR2Object(key,bytes,'image/webp');
  try{
   await supa('/rest/v1/loox_creator_profiles?user_id=eq.'+u.id,{method:'PATCH',body:JSON.stringify({cover_key:key})});
  }catch(e){await deleteR2Object(key).catch(()=>{});throw e;}
  if(profile.cover_key&&profile.cover_key!==key)await deleteR2Object(profile.cover_key).catch(()=>{});
  return res.json({saved:true,cover_key:key});
 }
 if(action==='details'){
  method(req,'POST');await limit(u,'profile_details',12,3600);const b=json(req);
  need(typeof b.location==='string'&&b.location.length<=80,400,'Location must be at most 80 characters.');
  need(typeof b.website==='string'&&b.website.length<=250,400,'Website link is too long.');
  const location=b.location.trim(),raw=b.website.trim();
  let website=null;
  if(raw){
   try{
    const parsed=new URL(raw);
    need(parsed.protocol==='https:'&&parsed.hostname.includes('.')&&!parsed.username&&!parsed.password,400,'Use a valid HTTPS website address.');
    website=parsed.href;
   }catch(e){if(e.status)throw e;need(false,400,'Use a valid HTTPS website address.');}
  }
  const [profile]=await rows('creator_profiles',{user_id:'eq.'+u.id,select:'user_id',limit:'1'});
  need(profile,404,'Create your profile before editing its details.');
  await supa('/rest/v1/loox_creator_profiles?user_id=eq.'+u.id,{method:'PATCH',body:JSON.stringify({profile_location:location||null,profile_website:website})});
  return res.json({saved:true});
 }
 if(action==='pin'){
  method(req,'POST');await limit(u,'profile_pin',15,3600);const b=json(req);
  need(b.post===null||uuid.test(b.post),400,'Invalid pinned post.');
  if(b.post!==null){
   const [post]=await rows('community_posts',{id:'eq.'+b.post,creator_id:'eq.'+u.id,status:'eq.approved',visible:'eq.true',select:'id',limit:'1'});
   need(post,404,'Only your approved visible posts can be pinned.');
  }
  await supa('/rest/v1/loox_creator_profiles?user_id=eq.'+u.id,{method:'PATCH',body:JSON.stringify({pinned_post_id:b.post})});
  return res.json({saved:true,pinned_post_id:b.post});
 }
 if(action==='view_start'||action==='view_record'){
  method(req,'POST');await limit(u,'video_views',30);const b=json(req);need(uuid.test(b.post),400,'Invalid post.');
  const post=await rpc('public_post',{p_id:b.post});need(post&&post.media_type==='video',404,'Public video not found.');
  if(action==='view_start')return res.json(viewChallenge(u,post));validateView(u,post,b.token);return res.json({views:await rpc('record_view',{p_user:u.id,p_post:b.post})});
 }
 need(u.app_metadata?.loox_template_admin===true,403,'Administrator access required.');
 await limit(u,'admin',60);
 if(action==='overview'){method(req,'GET');return res.json(await rpc('admin_overview',{}));}
 if(action==='users'){
  method(req,'GET');const page=Number(req.query.page||1);need(Number.isInteger(page)&&page>=1&&page<=10000,400,'Invalid page.');
  const data=await supa('/auth/v1/admin/users?'+new URLSearchParams({page:String(page),per_page:'25'}));
  const users=Array.isArray(data)?data:data.users||[],ids=users.map(x=>x.id);
  const filter={user_id:'in.('+ids.join(',')+')'};
  const [profiles,wallets,subscriptions]=ids.length?await Promise.all([rows('creator_profiles',{...filter,select:'user_id,username,display_name'}),rows('wallets',{...filter,select:'user_id,balance,debt'}),rows('subscriptions',{...filter,select:'user_id,plan,status,ends_at'})]):[[],[],[]];
  return res.json({items:users.map(x=>({id:x.id,email:x.email,created_at:x.created_at,last_sign_in_at:x.last_sign_in_at,email_confirmed:!!x.email_confirmed_at,profile:profiles.find(p=>p.user_id===x.id)||null,wallet:wallets.find(w=>w.user_id===x.id)||null,subscriptions:subscriptions.filter(s=>s.user_id===x.id)})),has_more:users.length===25});
 }
 if(action==='reports'){
  method(req,'GET');const offset=Number(req.query.offset||0);need(Number.isInteger(offset)&&offset>=0&&offset<=10000,400,'Invalid page.');return res.json({items:await rows('content_reports',{status:'eq.open',select:'id,post_id,comment_id,reason,created_at',order:'created_at.asc',limit:'25',offset:String(offset)})});
 }
 if(action==='resolve'){
  method(req,'POST');const b=json(req);need(uuid.test(b.id)&&['resolved','dismissed'].includes(b.status),400,'Invalid report action.');
  return res.json(await rpc('admin_resolve_report',{p_admin:u.id,p_id:b.id,p_status:b.status,p_remove:b.remove===true}));
 }
 if(action==='credits'){
  await requireFinancialAdmin(req,u);
  method(req,'POST');await limit(u,'admin_credits',10,3600);const b=json(req);need(uuid.test(b.user)&&uuid.test(b.requestId)&&Number.isInteger(b.amount)&&b.amount!==0&&Math.abs(b.amount)<=10000&&typeof b.reason==='string'&&b.reason.trim().length>=5&&b.reason.length<=300,400,'Enter an account, amount (up to 10,000), and reason.');
  return res.json(await rpc('admin_adjust_credits',{p_admin:u.id,p_user:b.user,p_amount:b.amount,p_reason:b.reason.trim(),p_request:b.requestId}));
 }
 if(action==='catalog'){method(req,'GET');return res.json({items:await rows('template_catalog',{select:'id,title,kind,category,active',order:'category,title',limit:'100'})});}
 if(action==='template_state'){
  method(req,'POST');const b=json(req);need(typeof b.id==='string'&&/^[a-z0-9-]{3,80}$/.test(b.id)&&typeof b.active==='boolean',400,'Invalid template.');
  await supa('/rest/v1/loox_template_catalog?'+new URLSearchParams({id:'eq.'+b.id}),{method:'PATCH',body:JSON.stringify({active:b.active})});
  await supa('/rest/v1/loox_moderation_log',{method:'POST',body:JSON.stringify({admin_id:u.id,action:'template_state',reason:b.id+' / '+(b.active?'enabled':'disabled')})});return res.json({saved:true});
 }
 if(action==='models'){method(req,'GET');return res.json({items:await rows('operations',{select:'id,cost,max_millicents',order:'id',limit:'100'})});}
 need(false,404,'Unknown administration action.');
}
