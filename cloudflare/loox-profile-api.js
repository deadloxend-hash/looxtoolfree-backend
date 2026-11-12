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
async function discover(db,url,me){
 const kind=url.searchParams.get('kind')||'all',sort=url.searchParams.get('sort')||'latest';
 const creator=url.searchParams.get('creator'),term=(url.searchParams.get('query')||'').trim().slice(0,100);
 const collection=url.searchParams.get('collection');
 const days=Math.max(1,Math.min(30,Number(url.searchParams.get('days'))||30));
 const offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0));
 if(!['all','image','video'].includes(kind)||!['latest','following','trending','popular','saved','liked'].includes(sort))bad(400,'Invalid discovery filter.');
 if(creator)needId(creator);
 if(collection)needId(collection);
 if(['saved','liked','following'].includes(sort)&&!me)bad(401,'Sign in to view this feed.');
 const args=[me?.id||'',me?.id||''];
 const conditions=["p.status='approved'","p.visible=1","(c.is_private=0 OR c.user_id=?)"];
 args.push(me?.id||'');
 if(kind!=='all'){conditions.push('p.media_type=?');args.push(kind);}
 if(creator){conditions.push('p.creator_id=?');args.push(creator);}
 if(term){conditions.push("(lower(p.caption||' '||c.username||' '||c.display_name||' '||coalesce(p.model_id,'')) LIKE ?)");args.push('%'+term.toLowerCase()+'%');}
 if(sort==='following'){conditions.push('EXISTS(SELECT 1 FROM follows f WHERE f.creator_id=p.creator_id AND f.follower_id=?)');args.push(me.id);}
 if(sort==='saved'){conditions.push('EXISTS(SELECT 1 FROM saved_posts sv WHERE sv.post_id=p.id AND sv.user_id=?)');args.push(me.id);}
 if(sort==='liked'){conditions.push('EXISTS(SELECT 1 FROM post_likes ll WHERE ll.post_id=p.id AND ll.user_id=?)');args.push(me.id);}
 if(sort==='trending'){conditions.push("p.created_at>=datetime('now', ?)");args.push('-'+days+' days');}
 if(collection){conditions.push("EXISTS(SELECT 1 FROM collection_items i JOIN collections cl ON cl.id=i.collection_id WHERE i.post_id=p.id AND cl.id=? AND (cl.user_id=? OR (cl.is_public=1 AND EXISTS(SELECT 1 FROM profiles c2 WHERE c2.user_id=cl.user_id AND c2.is_private=0))))");args.push(collection,me?.id||'');}
 const sql='SELECT p.id,p.creator_id,p.media_path,p.media_type,p.caption,p.shared_prompt,p.status,p.visible,p.created_at,'+
 'p.comments_enabled,p.allow_remix,p.allow_download,p.model_id,p.view_count,p.media_provider,'+
 'c.username,c.display_name,c.avatar_path,'+
 '(SELECT count(*) FROM post_likes l WHERE l.post_id=p.id) likes,'+
 '(SELECT count(*) FROM comments cm WHERE cm.post_id=p.id) comments,'+
 '(SELECT count(*) FROM saved_posts sv WHERE sv.post_id=p.id) saves,'+
 'EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=?) liked,'+
 'EXISTS(SELECT 1 FROM saved_posts sv WHERE sv.post_id=p.id AND sv.user_id=?) saved '+
 'FROM posts p JOIN profiles c ON c.user_id=p.creator_id WHERE '+conditions.join(' AND ')+
 (sort==='popular'?' ORDER BY likes DESC,p.created_at DESC':
  sort==='trending'?' ORDER BY (likes*2+comments*3+p.view_count/25.0)/(1.0+MAX(0,julianday("now")-julianday(p.created_at))) DESC,p.created_at DESC':
  ' ORDER BY p.created_at DESC')+' LIMIT 25 OFFSET ?';
 args.push(offset);
 const rows=await stmt(db,sql,...args).all();
 return {items:rows.results.slice(0,24).map(p=>({...p,liked:!!p.liked,saved:!!p.saved,visible:!!p.visible})),has_more:rows.results.length>24};
}
async function publicPost(db,url,me){
 const id=needId(url.searchParams.get('id'));
 // Query the requested ID directly, never rely on a bounded discovery feed.
 const row=await stmt(db,"SELECT p.*,c.username,c.display_name,c.avatar_path,(SELECT count(*) FROM post_likes l WHERE l.post_id=p.id) likes,(SELECT count(*) FROM comments m WHERE m.post_id=p.id) comments,EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=?) liked,EXISTS(SELECT 1 FROM saved_posts s WHERE s.post_id=p.id AND s.user_id=?) saved FROM posts p JOIN profiles c ON c.user_id=p.creator_id WHERE p.id=? AND p.status='approved' AND p.visible=1 AND (c.is_private=0 OR c.user_id=?)",me?.id||'',me?.id||'',id,me?.id||'').first();
 return row?{...row,liked:!!row.liked,saved:!!row.saved}:null;
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
 const rows=await stmt(db,'SELECT n.*,p.username,p.display_name,p.avatar_path,post.caption post_caption,post.media_path post_media_path,post.media_type post_media_type,cm.body comment_body FROM notifications n LEFT JOIN profiles p ON p.user_id=n.actor_id LEFT JOIN posts post ON post.id=n.post_id LEFT JOIN comments cm ON cm.id=n.comment_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 26 OFFSET ?',me.id,offset).all();
 return {items:rows.results.slice(0,25),has_more:rows.results.length>25};
}
async function collectionList(db,url,me){
 const id=url.searchParams.get('id'),userId=url.searchParams.get('user_id');
 if(id){
  needId(id);
  const row=await stmt(db,'SELECT c.* FROM collections c JOIN profiles p ON p.user_id=c.user_id WHERE c.id=? AND (c.user_id=? OR (c.is_public=1 AND p.is_private=0))',id,me?.id||'').first();
  if(!row)bad(404,'Collection unavailable.');
  return {items:[row],has_more:false};
 }
 const owner=userId?needId(userId):me?.id;
 if(!owner)bad(401,'Sign in to view collections.');
 const rows=await stmt(db,'SELECT c.* FROM collections c JOIN profiles p ON p.user_id=c.user_id WHERE c.user_id=? AND (c.user_id=? OR (c.is_public=1 AND p.is_private=0)) ORDER BY c.created_at DESC LIMIT 100',owner,me?.id||'').all();
 return {items:rows.results,has_more:false};
}
async function collectionSave(db,me,data,method){
 await ensureSelf(db,me);
 if(method==='POST'){
  const name=String(data.name||'').trim();
  if(!name||name.length>80)bad(400,'Collection name must be 1–80 characters.');
  const count=await stmt(db,'SELECT COUNT(*) n FROM collections WHERE user_id=?',me.id).first();
  if(Number(count.n)>=100)bad(429,'You have reached your collection limit.');
  const id=crypto.randomUUID();
  await stmt(db,'INSERT INTO collections(id,user_id,name,is_public,created_at) VALUES(?,?,?,?,?)',id,me.id,name,data.is_public===true?1:0,now()).run();
  return {id,name,is_public:data.is_public===true};
 }
 const id=needId(data.id);
 const own=await stmt(db,'SELECT * FROM collections WHERE id=? AND user_id=?',id,me.id).first();
 if(!own)bad(404,'Collection unavailable.');
 if(method==='DELETE'){
  await stmt(db,'DELETE FROM collection_items WHERE collection_id=?',id).run();
  await stmt(db,'DELETE FROM collections WHERE id=? AND user_id=?',id,me.id).run();
  return {deleted:true};
 }
 const name=data.name===undefined?own.name:String(data.name||'').trim();
 if(!name||name.length>80)bad(400,'Collection name must be 1–80 characters.');
 await stmt(db,'UPDATE collections SET name=?,is_public=? WHERE id=? AND user_id=?',name,data.is_public===undefined?own.is_public:data.is_public===true?1:0,id,me.id).run();
 return {id,name};
}
async function collectionItem(db,me,data,method){
 await ensureSelf(db,me);
 const id=needId(data.collection_id),postId=needId(data.post_id);
 const collection=await stmt(db,'SELECT id FROM collections WHERE id=? AND user_id=?',id,me.id).first();
 if(!collection)bad(404,'Collection unavailable.');
 if(method==='POST'){
  const post=await stmt(db,"SELECT p.id FROM posts p JOIN profiles c ON c.user_id=p.creator_id WHERE p.id=? AND p.status='approved' AND p.visible=1 AND (c.is_private=0 OR c.user_id=?)",postId,me.id).first();
  if(!post)bad(404,'Post unavailable.');
  await stmt(db,'INSERT OR IGNORE INTO collection_items(collection_id,post_id,position,created_at) VALUES(?,?,?,?)',id,postId,0,now()).run();
 }else await stmt(db,'DELETE FROM collection_items WHERE collection_id=? AND post_id=?',id,postId).run();
 return {saved:true};
}

async function jobForPublish(env,request,me,jobId){
 const query=new URLSearchParams({id:'eq.'+jobId,user_id:'eq.'+me.id,state:'eq.succeeded',
  select:'id,operation,prompt,result_path,storage_provider,object_key,thumbnail_key,media_type',limit:'1'});
 const response=await fetch(env.SUPABASE_URL+'/rest/v1/loox_jobs?'+query,{
  headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:request.headers.get('Authorization'),Accept:'application/json'},
  redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok)bad(503,'Could not verify the completed AI creation.');
 const rows=await response.json();
 return Array.isArray(rows)?rows[0]:null;
}
async function publish(db,env,request,me,data){
 await ensureSelf(db,me);
 const jobId=needId(data.job_id),caption=String(data.caption||'').trim();
 if(!caption||caption.length>300)bad(400,'Enter a public caption of 1–300 characters.');
 const prior=await stmt(db,'SELECT id FROM posts WHERE job_id=?',jobId).first();
 if(prior)bad(409,'This creation has already been submitted.');
 const quota=await stmt(db,'SELECT COUNT(*) n FROM posts WHERE creator_id=? AND created_at>=?',me.id,
  new Date(Date.now()-86400000).toISOString()).first();
 if(Number(quota.n)>=25)bad(429,'Daily Community submission limit reached.');
 const job=await jobForPublish(env,request,me,jobId);
 if(!job||!job.prompt||!job.result_path||!job.result_path.startsWith(me.id+'/'))bad(404,'Completed creation not found.');
 if(!job.operation?.startsWith('generate')&&!job.operation?.startsWith('video_'))bad(400,'This AI operation cannot be shared.');
 if(job.storage_provider!=='r2'||!job.object_key)bad(409,'Only verified Cloudflare R2 creations can be shared through this service.');
 const key=String(job.object_key);
 if(!key.startsWith('users/'+me.id+'/')||key.includes('..'))bad(400,'Invalid R2 media key.');
 const id=crypto.randomUUID(),mediaType=job.media_type==='video'||job.operation.startsWith('video_')||job.operation.includes('video')?'video':'image';
 try{await stmt(db,'INSERT INTO posts(id,creator_id,job_id,media_path,media_type,caption,shared_prompt,status,visible,created_at,comments_enabled,allow_remix,allow_download,model_id,view_count,media_provider,media_key,thumbnail_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  id,me.id,jobId,job.result_path,mediaType,caption,data.share_prompt===true?job.prompt:null,'pending',0,now(),1,1,1,job.operation,0,'r2',key,job.thumbnail_key||null).run();}
 catch(e){if(/unique|constraint/i.test(String(e)))bad(409,'This creation was already submitted.');throw e;}
 return {id,status:'pending'};
}
async function reviewQueue(db,me){
 if(me?.data?.app_metadata?.loox_template_admin!==true)bad(403,'Administrator access required.');
 const rows=await stmt(db,"SELECT p.id,p.creator_id,p.caption,p.shared_prompt,p.media_type,p.media_key,p.thumbnail_key,p.created_at,c.username,c.display_name FROM posts p LEFT JOIN profiles c ON c.user_id=p.creator_id WHERE p.status='pending' ORDER BY p.created_at ASC LIMIT 100").all();
 return {items:rows.results};
}
async function reviewPost(db,me,data){
 if(me?.data?.app_metadata?.loox_template_admin!==true)bad(403,'Administrator access required.');
 const id=needId(data.id),decision=String(data.status||'');
 if(!['approved','rejected'].includes(decision))bad(400,'Invalid review decision.');
 const existing=await stmt(db,"SELECT id,creator_id,media_key FROM posts WHERE id=? AND status='pending'",id).first();
 if(!existing)bad(409,'Submission is no longer pending.');
 const outcome=await stmt(db,"UPDATE posts SET status=?,visible=? WHERE id=? AND status='pending'",decision,decision==='approved'?1:0,id).run();
 if(!outcome.meta?.changes)bad(409,'Submission already reviewed.');
 await stmt(db,'INSERT INTO notifications(id,user_id,kind,post_id,is_read,created_at) VALUES(?,?,?,?,0,?)',
  crypto.randomUUID(),existing.creator_id,decision,id,now()).run();
 return {id,status:decision};
}
async function managePosts(db,me,url){
 await ensureSelf(db,me);
 const offset=Math.max(0,Math.min(10000,Number(url.searchParams.get('offset'))||0));
 const rows=await stmt(db,"SELECT id,creator_id,job_id,media_type,caption,shared_prompt,status,visible,created_at,comments_enabled,allow_remix,allow_download FROM posts WHERE creator_id=? ORDER BY created_at DESC LIMIT 25 OFFSET ?",me.id,offset).all();
 return {items:rows.results.slice(0,24),has_more:rows.results.length>24};
}
async function editPost(db,me,data){
 await ensureSelf(db,me);
 const id=needId(data.id),action=String(data.action||'');
 if(!['edit','hide','show','delete','permissions'].includes(action))bad(400,'Unknown post action.');
 const existing=await stmt(db,'SELECT * FROM posts WHERE id=? AND creator_id=?',id,me.id).first();
 if(!existing)bad(404,'Post not found.');
 if(action==='delete'){
  await stmt(db,'DELETE FROM comments WHERE post_id=?',id).run();
  await stmt(db,'DELETE FROM post_likes WHERE post_id=?',id).run();
  await stmt(db,'DELETE FROM saved_posts WHERE post_id=?',id).run();
  await stmt(db,'DELETE FROM collection_items WHERE post_id=?',id).run();
  await stmt(db,'DELETE FROM notifications WHERE post_id=?',id).run();
  await stmt(db,'UPDATE profiles SET pinned_post_id=NULL WHERE pinned_post_id=?',id).run();
  await stmt(db,'DELETE FROM posts WHERE id=? AND creator_id=?',id,me.id).run();
  return {deleted:true};
 }
 if(action==='edit'){
  const caption=String(data.caption||'').trim();
  if(!caption||caption.length>300)bad(400,'Caption must be 1–300 characters.');
  let sharedPrompt=null;
  if(data.share_prompt===true){
   // Preserve the original prompt ONLY when it was previously approved for sharing.
   // Do not trust arbitrary prompt text from an untrusted browser.
   if(existing.shared_prompt)sharedPrompt=existing.shared_prompt;
   else if(existing.job_id)bad(409,'Use the original AI job prompt from an authorized re-submission to share it.');
  }
  await stmt(db,"UPDATE posts SET caption=?,shared_prompt=?,status='pending',visible=0 WHERE id=? AND creator_id=?",caption,sharedPrompt,id,me.id).run();
  return {saved:true,status:'pending'};
 }
 if(action==='show'||action==='hide'){
  if(action==='show'&&existing.status!=='approved')bad(409,'Await administrator approval before showing this post.');
  await stmt(db,'UPDATE posts SET visible=? WHERE id=? AND creator_id=?',action==='show'?1:0,id,me.id).run();
  return {saved:true};
 }
 await stmt(db,'UPDATE posts SET comments_enabled=?,allow_remix=?,allow_download=? WHERE id=? AND creator_id=?',
  data.comments!==false?1:0,data.remix!==false?1:0,data.download!==false?1:0,id,me.id).run();
 return {saved:true};
}
async function commentPermission(db,id,me){
 const post=await stmt(db,'SELECT p.id,p.creator_id,p.comments_enabled,c.is_private FROM posts p JOIN profiles c ON c.user_id=p.creator_id WHERE p.id=? AND p.status=? AND p.visible=1',id,'approved').first();
 if(!post||post.is_private&&me?.id!==post.creator_id)bad(404,'Post unavailable.');
 return post;
}
async function commentsList(db,url,me){
 const id=needId(url.searchParams.get('post_id'));
 await commentPermission(db,id,me);
 const offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0)),kind=url.searchParams.get('kind')||'parents';
 if(kind==='parents'){
  const rows=await stmt(db,'SELECT id,post_id,parent_id,user_id,body,created_at FROM comments WHERE post_id=? AND parent_id IS NULL ORDER BY created_at ASC,id ASC LIMIT 15 OFFSET ?',id,offset).all();
  return {items:rows.results,has_more:rows.results.length===15};
 }
 if(kind==='replies'){
  const ids=[...new Set(String(url.searchParams.get('parent_ids')||'').split(',').filter(validId))].slice(0,25);
  if(!ids.length)return {items:[],has_more:false};
  const placeholders=ids.map(()=>'?').join(',');
  const rows=await stmt(db,'SELECT id,post_id,parent_id,user_id,body,created_at FROM comments WHERE post_id=? AND parent_id IN ('+placeholders+') ORDER BY created_at ASC,id ASC LIMIT 201 OFFSET ?',id,...ids,offset).all();
  return {items:rows.results.slice(0,200),has_more:rows.results.length>200};
 }
 bad(400,'Invalid comment filter.');
}
async function commentCreate(db,me,data){
 await ensureSelf(db,me);
 const postId=needId(data.post_id),post=await commentPermission(db,postId,me);
 if(post.comments_enabled===0)bad(403,'Comments are disabled.');
 const body=String(data.body||'').trim();
 if(!body||body.length>1200)bad(400,'Comment must be between 1 and 1,200 characters.');
 const recent=await stmt(db,'SELECT COUNT(*) n FROM comments WHERE user_id=? AND created_at>=?',me.id,new Date(Date.now()-60000).toISOString()).first();
 if(Number(recent.n)>=8)bad(429,'Too many comments. Try again soon.');
 let parent=null,recipient=post.creator_id;
 if(data.parent_id){
  const id=needId(data.parent_id);
  parent=await stmt(db,'SELECT id,user_id FROM comments WHERE id=? AND post_id=?',id,postId).first();
  if(!parent)bad(404,'Parent comment unavailable.');
  recipient=parent.user_id;
 }
 const id=crypto.randomUUID(),created=now();
 await stmt(db,'INSERT INTO comments(id,post_id,user_id,body,created_at,parent_id) VALUES(?,?,?,?,?,?)',id,postId,me.id,body,created,parent?.id||null).run();
 if(recipient!==me.id){
  const pref=await stmt(db,'SELECT notifications_enabled FROM profiles WHERE user_id=?',recipient).first();
  if(pref?.notifications_enabled){
   await stmt(db,'INSERT INTO notifications(id,user_id,actor_id,post_id,comment_id,kind,is_read,created_at) VALUES(?,?,?,?,?,?,0,?)',
    crypto.randomUUID(),recipient,me.id,postId,id,parent?'reply':'comment',created).run();
  }
 }
 return {id,post_id:postId,user_id:me.id,body,created_at:created,parent_id:parent?.id||null};
}
async function commentDelete(db,url,me){
 const id=needId(url.searchParams.get('id'));
 const row=await stmt(db,'SELECT cm.*,p.creator_id FROM comments cm JOIN posts p ON p.id=cm.post_id WHERE cm.id=?',id).first();
 if(!row||row.user_id!==me.id&&row.creator_id!==me.id)bad(403,'You cannot delete this comment.');
 await stmt(db,'DELETE FROM comments WHERE id=?',id).run();
 return {deleted:true};
}
async function markNotifications(db,me,data){
 if(data.all===true)await stmt(db,'UPDATE notifications SET is_read=1 WHERE user_id=?',me.id).run();
 else await stmt(db,'UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?',needId(data.id),me.id).run();
 return {saved:true};
}
async function readMedia(db,r2,url,me,request){
 const id=needId(url.searchParams.get('id')),type=url.searchParams.get('type');
 let key=null,privateResult=false,mediaType='image/webp';
 if(type==='post'){
  const post=await stmt(db,"SELECT p.id,p.creator_id,p.media_type,p.media_key,p.thumbnail_key,p.status,p.visible,c.is_private FROM posts p JOIN profiles c ON c.user_id=p.creator_id WHERE p.id=?",id).first();
  if(!post)bad(404,'Post media unavailable.');
  const owner=me?.id===post.creator_id,admin=me?.data?.app_metadata?.loox_template_admin===true;
  if(!owner&&!admin&&(post.status!=='approved'||!post.visible||post.is_private))bad(404,'Post media unavailable.');
  key=url.searchParams.get('variant')==='original'?post.media_key:post.thumbnail_key||post.media_key;
  if(!key||!key.startsWith('users/'+post.creator_id+'/generations/')&&!key.startsWith('users/'+post.creator_id+'/thumbnails/'))bad(404,'Post media unavailable.');
  privateResult=!!post.is_private||post.status!=='approved'||!post.visible;
  mediaType=post.media_type==='video'&&key===post.media_key?'video/mp4':'image/webp';
 }else if(type==='avatar'||type==='cover'){
  const p=await stmt(db,'SELECT user_id,is_private,avatar_key,cover_key FROM profiles WHERE user_id=?',id).first();
  if(!p||p.is_private&&me?.id!==id)bad(404,'Profile unavailable.');
  key=type==='avatar'?p.avatar_key:p.cover_key;
  if(!key||!key.startsWith('public/avatars/'+id+'/'))bad(404,'Photo unavailable.');
  privateResult=!!p.is_private;
 }else bad(400,'Invalid media type.');
 let range=null;
 const header=request.headers.get('Range');
 if(mediaType==='video/mp4'&&header){
  const match=/^bytes=(\d+)-(\d*)$/.exec(header);
  if(match){
   const begin=Number(match[1]),end=match[2]?Number(match[2]):null;
   if(Number.isSafeInteger(begin)&&begin>=0&&(end===null||Number.isSafeInteger(end)&&end>=begin)){
    range={offset:begin};
    if(end!==null)range.length=Math.min(end-begin+1,20_000_000);
   }
  }
 }
 const object=await r2.get(key,range?{range}:undefined);
 if(!object)bad(404,'Media unavailable.');
 const headers=new Headers({
  'Content-Type':object.httpMetadata?.contentType||mediaType,
  'Cache-Control':privateResult?'private, no-store':'public, max-age=300',
  'Content-Disposition':'inline','Accept-Ranges':'bytes'
 });
 if(object.size)headers.set('Content-Length',String(object.body?.length??(range?object.range?.length||object.size:object.size)));
 if(range&&object.range){
  headers.set('Content-Range','bytes '+object.range.offset+'-'+(object.range.offset+object.range.length-1)+'/'+object.size);
  headers.set('Content-Length',String(object.range.length));
 }
 return new Response(object.body,{status:range&&object.range?206:200,headers});
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
   const anonymous=['profile','connections','profiles','feed','replies','media','discover','post','comments','collections'].includes(path)&&request.method==='GET';
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
   else if(path==='discover'&&request.method==='GET')response=send(await discover(env.DB,url,me));
   else if(path==='post'&&request.method==='GET')response=send(await publicPost(env.DB,url,me));
   else if(path==='publish'&&request.method==='POST')response=send(await publish(env.DB,env,request,me,await request.json()),201);
   else if(path==='review-queue'&&request.method==='GET')response=send(await reviewQueue(env.DB,me));
   else if(path==='review'&&request.method==='POST')response=send(await reviewPost(env.DB,me,await request.json()));
   else if(path==='manage'&&request.method==='GET')response=send(await managePosts(env.DB,me,url));
   else if(path==='manage'&&request.method==='POST')response=send(await editPost(env.DB,me,await request.json()));
   else if(path==='collections'&&request.method==='GET')response=send(await collectionList(env.DB,url,me));
   else if(path==='collections'&&['POST','PATCH','DELETE'].includes(request.method))response=send(await collectionSave(env.DB,me,await request.json(),request.method));
   else if(path==='collection-item'&&['POST','DELETE'].includes(request.method))response=send(await collectionItem(env.DB,me,await request.json(),request.method));
   else if(path==='comments'&&request.method==='GET')response=send(await commentsList(env.DB,url,me));
   else if(path==='comments'&&request.method==='POST')response=send(await commentCreate(env.DB,me,await request.json()),201);
   else if(path==='comments'&&request.method==='DELETE')response=send(await commentDelete(env.DB,url,me));
   else if(path==='replies'&&request.method==='GET')response=send(await replies(env.DB,url,me));
   else if(path==='like'&&request.method==='POST')response=send(await react(env.DB,me,await request.json(),'like'));
   else if(path==='save'&&request.method==='POST')response=send(await react(env.DB,me,await request.json(),'save'));
   else if(path==='notifications'&&request.method==='GET')response=send(await notifications(env.DB,url,me));
   else if(path==='notifications'&&request.method==='PATCH')response=send(await markNotifications(env.DB,me,await request.json()));
   else if(path==='media'&&request.method==='GET')response=await readMedia(env.DB,env.MEDIA,url,me,request);
   else if(['avatar','cover'].includes(path)&&request.method==='POST')response=send(await upload(env.DB,env.MEDIA,request,me,path),201);
   else if(['avatar','cover'].includes(path)&&request.method==='DELETE')response=send(await removeMedia(env.DB,me,path));
   else response=send({error:'Unknown creator API action.'},404);
   return cors(request,response);
  }catch(e){return cors(request,send({error:e instanceof HttpError?e.message:'Profile API temporarily unavailable.'},e instanceof HttpError?e.status:503));}
 }
};
