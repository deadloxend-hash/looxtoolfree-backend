import {viewChallenge,validateView} from './video-views.js';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {authenticate,env,method,json,need,limit,rows,supa,uuid,rpc} from './core.js';
import {putR2Object} from './r2.js';

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
