/* Cloudflare is the canonical creator profile database (D1) and artwork store (R2).
 * Identity tokens are verified against Supabase Auth; email and billing stay there.
 */
const ORIGIN='https://deadloxend-hash.github.io';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG=/^[a-z0-9_]{3,30}$/;
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const asInt=n=>Number(n)||0;
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const bad=(status,message)=>{throw new HttpError(status,message);};
const validId=x=>typeof x==='string'&&UUID.test(x);
const needId=x=>validId(x)?x:bad(400,'Invalid ID.');
const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const now=()=>new Date().toISOString();
const options=u=>({headers:{Authorization:u}});
function cors(request,response){
 const h=new Headers(response.headers),o=request.headers.get('Origin');
 if(o===ORIGIN){h.set('Access-Control-Allow-Origin',ORIGIN);h.set('Vary','Origin');}
 h.set('X-Content-Type-Options','nosniff');
 return new Response(response.body,{status:response.status,headers:h});
}
async function user(request,env,required=true){
 const auth=request.headers.get('Authorization')||'';
 if(!auth){if(required)bad(401,'Sign in to continue.');return null;}
 if(!/^Bearer [\w.-]{20,8192}$/.test(auth))bad(401,'Invalid session token.');
 const r=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{Authorization:auth,apikey:env.SUPABASE_PUBLISHABLE_KEY},redirect:'error',signal:AbortSignal.timeout(9000)});
 if(!r.ok){if(required)bad(401,'Please sign in again.');return null;}
 const u=await r.json();
 if(!validId(u.id)||u.is_anonymous||!u.email_confirmed_at)bad(403,'Verify your account.');
 return {id:u.id,data:u};
}
async function ensureSelf(db,me){
 if(!me)bad(401,'Sign in to continue.');
 let p=await stmt(db,'SELECT * FROM profiles WHERE user_id=?',me.id).first();
 if(!p){
  const handle='creator_'+me.id.replaceAll('-','').slice(0,20);
  const display=String(me.data.user_metadata?.full_name||me.data.user_metadata?.name||'LOOX creator').slice(0,60).trim()||'LOOX creator';
  await stmt(db,'INSERT OR IGNORE INTO profiles(user_id,username,display_name,created_at) VALUES(?,?,?,?)',me.id,handle,display,now()).run();
  p=await stmt(db,'SELECT * FROM profiles WHERE user_id=?',me.id).first();
 }
 return p;
}
async function summary(db,id,me){
 const p=await stmt(db,'SELECT * FROM profiles WHERE user_id=?',id).first();
 if(!p||p.is_private&&me?.id!==id)bad(404,'Creator profile is private or unavailable.');
 const counts=await stmt(db,
 'SELECT (SELECT COUNT(*) FROM posts WHERE creator_id=? AND status=? AND visible=1) posts,'+
 '(SELECT COALESCE(SUM(view_count),0) FROM posts WHERE creator_id=? AND status=? AND visible=1) total_views,'+
 '(SELECT COUNT(*) FROM follows WHERE creator_id=?) followers,'+
 '(SELECT COUNT(*) FROM follows WHERE follower_id=?) following,'+
 '(SELECT COUNT(*) FROM follows WHERE follower_id=? AND creator_id=?) followed',
 id,'approved',id,'approved',id,id,me?.id||'',id).first();
 return {
  user_id:p.user_id,username:p.username,display_name:p.display_name,bio:p.bio,
  avatar_path:p.avatar_path,avatar_key:p.avatar_key,avatar_thumbnail_key:p.avatar_thumbnail_key,
  cover_key:p.cover_key,profile_location:p.profile_location,profile_website:p.profile_website,
  created_at:p.created_at,pinned_post_id:p.pinned_post_id,
  is_private:!!p.is_private,hide_connections:!!p.hide_connections,
  ...(me?.id===id?{notifications_enabled:!!p.notifications_enabled}:{}),
  plan_badge:p.plan_badge||'Basic',posts:asInt(counts.posts),total_views:asInt(counts.total_views),
  followers:asInt(counts.followers),following:asInt(counts.following),followed:!!counts.followed
 };
}
async function profileGet(db,url,me){
 let id=url.searchParams.get('id'),name=url.searchParams.get('username');
 if(name){
  name=name.toLowerCase();if(!SLUG.test(name))bad(400,'Invalid username.');
  const p=await stmt(db,'SELECT user_id FROM profiles WHERE username=? COLLATE NOCASE',name).first();
  if(!p)bad(404,'Profile not found.');id=p.user_id;
 }else if(!id){id=(await ensureSelf(db,me)).user_id;}
 return summary(db,needId(id),me);
}
async function profileSave(db,me,data){
 const p=await ensureSelf(db,me);
 const name=String(data.display_name??p.display_name).trim(),username=String(data.username??p.username).trim().toLowerCase();
 const bio=String(data.bio??p.bio??'').trim(),loc=String(data.profile_location??p.profile_location??'').trim();
 const site=String(data.profile_website??p.profile_website??'').trim();
 if(!name||name.length>60||!SLUG.test(username)||bio.length>500||loc.length>80||site.length>250)bad(400,'Invalid profile information.');
 let website=null;
 if(site){
  try{const u=new URL(site);if(u.protocol!=='https:'||!u.hostname.includes('.')||u.username||u.password)bad(400,'Use a valid HTTPS website.');website=u.href;}catch(e){if(e instanceof HttpError)throw e;bad(400,'Use a valid HTTPS website.');}
 }
 try{
  await stmt(db,'UPDATE profiles SET display_name=?,username=?,bio=?,profile_location=?,profile_website=? WHERE user_id=?',
   name,username,bio,loc||null,website,me.id).run();
 }catch(e){if(/constraint|unique/i.test(String(e)))bad(409,'Username already taken.');throw e;}
 return summary(db,me.id,me);
}
async function privacySave(db,me,p){
 await ensureSelf(db,me);
 await stmt(db,'UPDATE profiles SET is_private=?,hide_connections=?,notifications_enabled=? WHERE user_id=?',
  p.is_private===true?1:0,p.hide_connections===true?1:0,p.notifications_enabled!==false?1:0,me.id).run();
 return summary(db,me.id,me);
}
async function followSave(db,me,p){
 await ensureSelf(db,me);
 const id=needId(p.creator_id);
 if(id===me.id)bad(400,'Cannot follow yourself.');
 const target=await stmt(db,'SELECT is_private FROM profiles WHERE user_id=?',id).first();
 if(!target||target.is_private)bad(404,'Creator is not available to follow.');
 if(p.follow===true){
  const change=await stmt(db,'INSERT OR IGNORE INTO follows(follower_id,creator_id,created_at) VALUES(?,?,?)',me.id,id,now()).run();
  if(change.meta?.changes)await stmt(db,'INSERT INTO notifications(id,user_id,actor_id,kind,is_read,created_at) VALUES(?,?,?,?,0,?)',crypto.randomUUID(),id,me.id,'follow',now()).run();
 }else await stmt(db,'DELETE FROM follows WHERE follower_id=? AND creator_id=?',me.id,id).run();
 return summary(db,id,me);
}
async function connections(db,url,me){
 const id=needId(url.searchParams.get('id')),kind=url.searchParams.get('kind');
 if(kind!=='followers'&&kind!=='following')bad(400,'Invalid connection list.');
 const creator=await stmt(db,'SELECT is_private,hide_connections FROM profiles WHERE user_id=?',id).first();
 if(!creator||creator.is_private&&me?.id!==id||creator.hide_connections&&me?.id!==id)return {hidden:true,items:[],has_more:false};
 const offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0));
 const column=kind==='followers'?'f.follower_id':'f.creator_id',where=kind==='followers'?'f.creator_id':'f.follower_id';
 const rows=await stmt(db,'SELECT p.user_id,p.username,p.display_name,p.bio,p.avatar_path,p.avatar_key FROM follows f JOIN profiles p ON p.user_id='+column+' WHERE '+where+'=? AND (p.is_private=0 OR p.user_id=?) ORDER BY f.created_at DESC LIMIT 25 OFFSET ?',id,me?.id||'',offset).all();
 return {hidden:false,items:rows.results.slice(0,24),has_more:rows.results.length>24};
}
async function profileBatch(db,url,me){
 const ids=[...new Set(String(url.searchParams.get('ids')||'').split(',').filter(validId))].slice(0,30);
 if(!ids.length)return {profiles:[]};
 const placeholders=ids.map(()=>'?').join(',');
 const rows=await stmt(db,'SELECT user_id,username,display_name,avatar_path,bio,is_private FROM profiles WHERE user_id IN ('+placeholders+') AND (is_private=0 OR user_id=?)',...ids,me?.id||'').all();
 return {profiles:rows.results};
}
async function pinSave(db,me,p){
 await ensureSelf(db,me);
 const id=p.post_id;
 if(id!==null){
  needId(id);
  const x=await stmt(db,"SELECT id FROM posts WHERE id=? AND creator_id=? AND status='approved' AND visible=1",id,me.id).first();
  if(!x)bad(404,'Only public approved posts can be pinned.');
 }
 await stmt(db,'UPDATE profiles SET pinned_post_id=? WHERE user_id=?',id,me.id).run();
 return {pinned_post_id:id};
}
async function feed(db,url,me){
 const tab=url.searchParams.get('tab')||'posts';
 if(!['posts','media','likes','saved'].includes(tab))bad(400,'Invalid profile tab.');
 const id=url.searchParams.get('creator_id');
 if(tab==='likes'||tab==='saved'){
  if(!me||id&&id!==me.id)bad(403,'This tab is private.');
 }else{
  needId(id);
  const p=await stmt(db,'SELECT is_private FROM profiles WHERE user_id=?',id).first();
  if(!p||p.is_private&&me?.id!==id)bad(404,'Profile unavailable.');
 }
 const offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0)),limit=24;
 const join=tab==='likes'?'JOIN post_likes x ON x.post_id=p.id AND x.user_id=?':tab==='saved'?'JOIN saved_posts x ON x.post_id=p.id AND x.user_id=?':'';
 const cond=tab==='likes'||tab==='saved'?'':'AND p.creator_id=?';
 const sql='SELECT p.*,c.username,c.display_name,c.avatar_path,c.avatar_key,'+
  '(SELECT COUNT(*) FROM post_likes l WHERE l.post_id=p.id) likes,'+
  '(SELECT COUNT(*) FROM comments m WHERE m.post_id=p.id) comments,'+
  '(SELECT COUNT(*) FROM saved_posts s WHERE s.post_id=p.id) saves,'+
  'EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=?) liked,'+
  'EXISTS(SELECT 1 FROM saved_posts s WHERE s.post_id=p.id AND s.user_id=?) saved '+
  'FROM posts p JOIN profiles c ON c.user_id=p.creator_id '+join+
  " WHERE p.status='approved' AND p.visible=1 AND (c.is_private=0 OR c.user_id=?) "+cond+
  ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
 const args=[me?.id||'',me?.id||''];
 if(join)args.push(me.id);
 args.push(me?.id||'');
 if(cond)args.push(id);
 args.push(limit+1,offset);
 const rows=await stmt(db,sql,...args).all();
 return {items:rows.results.slice(0,limit).map(p=>({...p,visible:!!p.visible,liked:!!p.liked,saved:!!p.saved})),has_more:rows.results.length>limit};
}
async function replies(db,url,me){
 const id=needId(url.searchParams.get('creator_id'));
 const p=await stmt(db,'SELECT is_private FROM profiles WHERE user_id=?',id).first();
 if(!p||p.is_private&&me?.id!==id)bad(404,'Profile unavailable.');
 const offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0));
 const rows=await stmt(db,'SELECT m.id,m.post_id,m.user_id,m.body,m.created_at,m.parent_id FROM comments m JOIN posts p ON p.id=m.post_id JOIN profiles c ON c.user_id=p.creator_id '+
  "WHERE m.user_id=? AND p.status='approved' AND p.visible=1 AND (c.is_private=0 OR c.user_id=?) ORDER BY m.created_at DESC LIMIT 21 OFFSET ?",id,me?.id||'',offset).all();
 return {items:rows.results.slice(0,20),has_more:rows.results.length>20};
}
async function react(db,me,p,kind){
 await ensureSelf(db,me);
 const id=needId(p.post_id);
 const post=await stmt(db,"SELECT p.creator_id,c.is_private FROM posts p JOIN profiles c ON c.user_id=p.creator_id WHERE p.id=? AND p.status='approved' AND p.visible=1",id).first();
 if(!post||post.is_private&&post.creator_id!==me.id)bad(404,'Post unavailable.');
 if(kind==='like'){
  if(post.creator_id===me.id)bad(400,'Cannot like your own creation.');
  if(p.on===true){
   const change=await stmt(db,'INSERT OR IGNORE INTO post_likes(post_id,user_id,created_at) VALUES(?,?,?)',id,me.id,now()).run();
   if(change.meta?.changes)await stmt(db,'INSERT INTO notifications(id,user_id,actor_id,post_id,kind,is_read,created_at) VALUES(?,?,?,?,?,0,?)',crypto.randomUUID(),post.creator_id,me.id,id,'like',now()).run();
  }else await stmt(db,'DELETE FROM post_likes WHERE post_id=? AND user_id=?',id,me.id).run();
 }else{
  if(p.on===true)await stmt(db,'INSERT OR IGNORE INTO saved_posts(user_id,post_id,created_at) VALUES(?,?,?)',me.id,id,now()).run();
  else await stmt(db,'DELETE FROM saved_posts WHERE user_id=? AND post_id=?',me.id,id).run();
 }
 return {post_id:id,on:p.on===true};
}
async function notifications(db,url,me){
 const offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0));
 const rows=await stmt(db,'SELECT n.*,p.username,p.display_name,p.avatar_path FROM notifications n LEFT JOIN profiles p ON p.user_id=n.actor_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 26 OFFSET ?',me.id,offset).all();
 return {items:rows.results.slice(0,25),has_more:rows.results.length>25};
}
async function readMedia(db,r2,url,me){
 const id=needId(url.searchParams.get('id')),type=url.searchParams.get('type');
 if(type!=='avatar'&&type!=='cover')bad(400,'Invalid profile media.');
 const p=await stmt(db,'SELECT is_private,avatar_key,cover_key FROM profiles WHERE user_id=?',id).first();
 if(!p||p.is_private&&me?.id!==id)bad(404,'Profile unavailable.');
 const key=type==='avatar'?p.avatar_key:p.cover_key;
 if(!key||!key.startsWith('public/avatars/'+id+'/'))bad(404,'Photo unavailable.');
 const object=await r2.get(key);
 if(!object)bad(404,'Photo unavailable.');
 return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'image/webp','Cache-Control':p.is_private?'private,no-store':'public,max-age=300','Content-Disposition':'inline'}});
}
function imageType(bytes,type){
 if(type==='image/png')return bytes.length>8&&[137,80,78,71,13,10,26,10].every((v,i)=>v===bytes[i]);
 if(type==='image/jpeg')return bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(type==='image/webp')return bytes.length>12&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
 return false;
}
async function upload(db,r2,request,me,kind){
 await ensureSelf(db,me);
 const type=(request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
 if(!['image/png','image/jpeg','image/webp'].includes(type))bad(415,'Choose a PNG, JPG or WebP.');
 const max=kind==='avatar'?2097152:4000000;
 if(Number(request.headers.get('Content-Length')||0)>max)bad(413,'Image exceeds upload limit.');
 const payload=await request.arrayBuffer();
 if(!payload.byteLength||payload.byteLength>max)bad(413,'Image exceeds upload limit.');
 const bytes=new Uint8Array(payload);
 if(!imageType(bytes,type))bad(400,'Invalid image signature.');
 const hourly=await stmt(db,'SELECT COUNT(*) n FROM image_uploads WHERE user_id=? AND created_at>=?',me.id,new Date(Date.now()-3600000).toISOString()).first();
 if(Number(hourly.n)>=8)bad(429,'Profile image uploads limited. Try again later.');
 const key='public/avatars/'+me.id+'/'+(kind==='cover'?'banner-':'')+crypto.randomUUID()+'.'+({ 'image/webp':'webp','image/png':'png','image/jpeg':'jpg' }[type]);
 await r2.put(key,bytes,{httpMetadata:{contentType:type}});
 try{
  if(kind==='cover')await stmt(db,'UPDATE profiles SET cover_key=? WHERE user_id=?',key,me.id).run();
  else{
   const path=me.id+'/'+key.split('/').pop();
   await stmt(db,"UPDATE profiles SET avatar_provider='r2',avatar_path=?,avatar_key=?,avatar_thumbnail_key=? WHERE user_id=?",path,key,key,me.id).run();
  }
  await stmt(db,'INSERT INTO image_uploads(id,user_id,created_at) VALUES(?,?,?)',crypto.randomUUID(),me.id,now()).run();
 }catch(e){await r2.delete(key).catch(()=>{});throw e;}
 return {key,avatar_path:kind==='avatar'?me.id+'/'+key.split('/').pop():null};
}
async function removeMedia(db,me,kind){
 await ensureSelf(db,me);
 if(kind==='cover')await stmt(db,'UPDATE profiles SET cover_key=NULL WHERE user_id=?',me.id).run();
 else await stmt(db,'UPDATE profiles SET avatar_key=NULL,avatar_path=NULL,avatar_thumbnail_key=NULL WHERE user_id=?',me.id).run();
 return {saved:true};
}
export default {
 async fetch(request,env){
  try{
   const url=new URL(request.url),path=url.pathname.replace(/^\/v1\/?/,'');
   if(request.method==='OPTIONS'){
    if(request.headers.get('Origin')!==ORIGIN)return new Response(null,{status:403});
    return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600'}});
   }
   if(request.headers.has('Origin')&&request.headers.get('Origin')!==ORIGIN)bad(403,'Origin is not allowed.');
   if(path==='health'&&request.method==='GET')return cors(request,send({ok:true,storage:'cloudflare-d1-r2',version:1}));
   const anonymous=['profile','connections','profiles','feed','replies','media'].includes(path)&&request.method==='GET';
   const me=await user(request,env,!anonymous);
   let response;
   if(path==='profile'&&request.method==='GET')response=send(await profileGet(env.DB,url,me));
   else if(path==='profile'&&request.method==='PATCH')response=send(await profileSave(env.DB,me,await request.json()));
   else if(path==='privacy'&&request.method==='PATCH')response=send(await privacySave(env.DB,me,await request.json()));
   else if(path==='follow'&&request.method==='POST')response=send(await followSave(env.DB,me,await request.json()));
   else if(path==='connections'&&request.method==='GET')response=send(await connections(env.DB,url,me));
   else if(path==='profiles'&&request.method==='GET')response=send(await profileBatch(env.DB,url,me));
   else if(path==='pin'&&request.method==='POST')response=send(await pinSave(env.DB,me,await request.json()));
   else if(path==='feed'&&request.method==='GET')response=send(await feed(env.DB,url,me));
   else if(path==='replies'&&request.method==='GET')response=send(await replies(env.DB,url,me));
   else if(path==='like'&&request.method==='POST')response=send(await react(env.DB,me,await request.json(),'like'));
   else if(path==='save'&&request.method==='POST')response=send(await react(env.DB,me,await request.json(),'save'));
   else if(path==='notifications'&&request.method==='GET')response=send(await notifications(env.DB,url,me));
   else if(path==='media'&&request.method==='GET')response=await readMedia(env.DB,env.MEDIA,url,me);
   else if(['avatar','cover'].includes(path)&&request.method==='POST')response=send(await upload(env.DB,env.MEDIA,request,me,path),201);
   else if(['avatar','cover'].includes(path)&&request.method==='DELETE')response=send(await removeMedia(env.DB,me,path));
   else response=send({error:'Unknown creator API action.'},404);
   return cors(request,response);
  }catch(e){return cors(request,send({error:e instanceof HttpError?e.message:'Profile API temporarily unavailable.'},e instanceof HttpError?e.status:503));}
 }
};
