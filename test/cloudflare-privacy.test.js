import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {accountExport,accountCleanup} from '../cloudflare/loox-profile-api.js';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',C='00000000-0000-4000-8000-000000000003';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`create table profiles(user_id text primary key,username text,is_private integer);create table account_display_names(user_id text primary key,name text,created_at text);
 create table posts(id text primary key,creator_id text,visible integer,caption text);create table collections(id text primary key,user_id text,name text);
 create table collection_items(collection_id text,post_id text,position integer,created_at text);create table comments(id text primary key,post_id text,user_id text,body text,parent_id text);
 create table post_likes(post_id text,user_id text,created_at text);create table saved_posts(post_id text,user_id text,created_at text);
 create table notifications(id text,user_id text,actor_id text,post_id text);create table follows(follower_id text,creator_id text,created_at text);
 create table image_uploads(id text,user_id text,created_at text);create table action_windows(user_id text,action text,window_start integer,count integer);
 insert into profiles values('${A}','owner',0),('${B}','other',0),('${C}','third',0);
 insert into account_display_names values('${A}','Owner',null),('${B}','Other',null);
 insert into posts values('pa','${A}',1,'Owner private text'),('pb','${B}',1,'Foreign text');
 insert into collections values('ca','${A}','Owner collection'),('cb','${B}','Other collection');
 insert into collection_items values('ca','pb',0,''),('cb','pa',0,''),('cb','pb',1,'');
 insert into comments values('one','pa','${B}','Reply to owner post',null),('two','pb','${A}','Owner comment',null),('three','pb','${B}','Foreign reply','two');
 insert into post_likes values('pa','${B}',''),('pb','${A}',''),('pb','${C}','');
 insert into saved_posts values('pa','${B}',''),('pb','${A}',''),('pb','${C}','');
 insert into notifications values('n1','${B}','${A}','pb'),('n2','${A}','${B}','pa'),('n3','${B}','${C}','pb');
 insert into follows values('${A}','${B}',''),('${B}','${A}',''),('${B}','${C}','');
 insert into image_uploads values('up1','${A}',''),('up2','${B}','');insert into action_windows values('${A}','profile',1,1),('${B}','profile',1,1);`);
 sql.exec(readFileSync(new URL('../cloudflare/privacy-lifecycle.sql',import.meta.url),'utf8'));
 const db={prepare(query){let args=[];return {bind(...values){args=values;return this},async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}}}}},async batch(statements){sql.exec('begin');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('commit');return result;}catch(e){sql.exec('rollback');throw e;}}};
 const objects=new Map([[`users/${A}/generations/a.png`,{size:10}],[`public/avatars/${A}/a.webp`,{size:20}],[`users/${B}/generations/b.png`,{size:30}],[`public/templates/${A}/template.png`,{size:40}]]);
 const r2={async list({prefix,limit=1000,cursor}){const keys=[...objects.keys()].filter(x=>x.startsWith(prefix)&&(!cursor||x>cursor)).sort();const selected=keys.slice(0,limit);return {objects:selected.map(key=>({key,...objects.get(key)})),truncated:keys.length>limit,cursor:keys.length>limit?selected.at(-1):undefined}},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key)}};
 return {sql,db,r2,objects};
}
test('Cloudflare data export includes only owner records, connections and private media prefixes',async()=>{
 const f=fixture();try{const data=await accountExport(f.db,f.r2,A);assert.equal(data.records.profile.length,1);assert.equal(data.records.posts.length,1);assert.equal(data.records.posts[0].caption,'Owner private text');assert.equal(data.records.comments.length,1);assert.equal(data.records.collection_items.length,1);assert.equal(data.media.length,2);assert.ok(!JSON.stringify(data).includes('Foreign text'));assert.ok(data.media.every(x=>!x.key.includes(B)));}finally{f.sql.close();}
});
test('account cleanup preserves foreign content, platform templates and replies while removing owner data',async()=>{
 const f=fixture();try{const result=await accountCleanup(f.db,f.r2,A);assert.equal(result.complete,true);assert.equal(result.removed_files,2);
 assert.equal(f.sql.prepare('select count(*) n from profiles where user_id=?').get(A).n,0);assert.equal(f.sql.prepare('select count(*) n from posts').get().n,1);
 assert.equal(f.sql.prepare('select parent_id from comments where id=?').get('three').parent_id,null);
 assert.equal(f.sql.prepare('select count(*) n from comments').get().n,1);assert.equal(f.sql.prepare('select count(*) n from collection_items').get().n,1);
 assert.equal(f.sql.prepare('select count(*) n from follows').get().n,1);assert.equal(f.sql.prepare('select count(*) n from notifications').get().n,1);
 assert.ok(f.objects.has(`users/${B}/generations/b.png`));assert.ok(f.objects.has(`public/templates/${A}/template.png`));
 assert.throws(()=>f.sql.prepare('insert into profiles values(?,?,0)').run(A,'late'),/account_deleting/);
 assert.throws(()=>f.sql.prepare('insert into post_likes values(?,?,?)').run('pa',B,''),/post_unavailable/);
 assert.equal((await accountCleanup(f.db,f.r2,A)).complete,true);
 }finally{f.sql.close();}
});
test('large cleanup is resumable and never removes a different user prefix',async()=>{
 const f=fixture();try{for(let i=0;i<105;i++)f.objects.set(`users/${A}/inputs/${String(i).padStart(3,'0')}.png`,{size:1});
 assert.equal((await accountCleanup(f.db,f.r2,A,{maxPages:1})).complete,false);assert.equal(f.sql.prepare('select is_private from profiles where user_id=?').get(A).is_private,1);
 assert.equal((await accountCleanup(f.db,f.r2,A,{maxPages:1})).complete,true);assert.ok(f.objects.has(`users/${B}/generations/b.png`));
 }finally{f.sql.close();}
});
