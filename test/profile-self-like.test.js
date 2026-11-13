import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercise the real Worker reaction handler against a small D1 mock.
// This specifically prevents future reintroduction of the owner-like 400.
const source=fs.readFileSync(new URL('../cloudflare/loox-profile-api.js',import.meta.url),'utf8');
const start=source.indexOf('async function react(db,me,p,kind){');
const end=source.indexOf('\nasync function notifications(',start);
assert.ok(start>=0&&end>start,'Cloudflare reaction handler must exist');
const body=source.slice(start,end);
const author='11111111-1111-4111-8111-111111111111';
const outsider='22222222-2222-4222-8222-222222222222';
const postId='33333333-3333-4333-8333-333333333333';

function fixture({privatePost=false,available=true}={}){
 const likes=new Set(),alerts=[],limits=[];
 const stmt=(_db,sql,...args)=>({
  async first(){
   assert.match(sql,/FROM posts p JOIN profiles/);
   return available?{creator_id:author,is_private:privatePost?1:0}:null;
  },
  async run(){
   if(sql.startsWith('INSERT OR IGNORE INTO post_likes')){
    const key=args[0]+':'+args[1],existed=likes.has(key);
    likes.add(key);return {meta:{changes:existed?0:1}};
   }
   if(sql.startsWith('DELETE FROM post_likes')){
    const key=args[0]+':'+args[1],existed=likes.delete(key);
    return {meta:{changes:existed?1:0}};
   }
   if(sql.startsWith('INSERT INTO notifications')){
    alerts.push({user:args[1],actor:args[2],post:args[3],kind:args[4]});
    return {meta:{changes:1}};
   }
   if(sql.startsWith('INSERT OR IGNORE INTO saved_posts')||sql.startsWith('DELETE FROM saved_posts'))return {meta:{changes:1}};
   throw Error('Unexpected SQL: '+sql);
  }
 });
 const bad=(status,message)=>{const error=Error(message);error.status=status;throw error;};
 const handler=new Function('ensureSelf','limitActions','needId','stmt','now','bad','crypto',
  body+'\nreturn react;')(
   async(_db,me)=>{if(!me)bad(401,'Sign in to continue.');},
   async(_db,id,kind)=>{limits.push({id,kind});},
   id=>{assert.equal(id,postId);return id;},
   stmt,
   ()=>'2026-11-13T00:00:00Z',
   bad,
   {randomUUID:()=> '44444444-4444-4444-8444-444444444444'}
  );
 return {handler,likes,alerts,limits};
}

test('creator can like and unlike own approved post without self-notification',async()=>{
 const f=fixture();
 const me={id:author},yes={post_id:postId,on:true};
 assert.deepEqual(await f.handler({},me,yes,'like'),{post_id:postId,on:true});
 assert.equal(f.likes.size,1);
 assert.equal(f.alerts.length,0,'No notification to yourself');
 // Repeat must be idempotent.
 await f.handler({},me,yes,'like');
 assert.equal(f.likes.size,1);
 assert.equal(f.alerts.length,0);
 await f.handler({},me,{post_id:postId,on:false},'like');
 assert.equal(f.likes.size,0);
});

test('other people can still like a public post and notify its creator once',async()=>{
 const f=fixture(),me={id:outsider},yes={post_id:postId,on:true};
 await f.handler({},me,yes,'like');
 assert.equal(f.likes.size,1);
 assert.deepEqual(f.alerts,[{user:author,actor:outsider,post:postId,kind:'like'}]);
 await f.handler({},me,yes,'like');
 assert.equal(f.alerts.length,1,'Idempotent like cannot duplicate notifications');
});

test('liking a private or unavailable post remains restricted',async()=>{
 const privatePost=fixture({privatePost:true});
 await assert.rejects(privatePost.handler({},{id:outsider},{post_id:postId,on:true},'like'),
  error=>error.status===404);
 assert.equal(privatePost.likes.size,0);
 const missing=fixture({available:false});
 await assert.rejects(missing.handler({},{id:author},{post_id:postId,on:true},'like'),
  error=>error.status===404);
 assert.equal(missing.likes.size,0);
});
