import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const r2=readFileSync(new URL('../lib/r2.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('../lib/r2-migration.js',import.meta.url),'utf8');
const imageCloud=readFileSync(new URL('../lib/image-cloud.js',import.meta.url),'utf8');

test('R2 remains private and server-side',()=>{
 assert.match(r2,/AWS4-HMAC-SHA256/);
 assert.match(r2,/LOOX_R2_SECRET_ACCESS_KEY/);
 assert.doesNotMatch(r2,/publicBucket/);
});
test('migration verifies bytes before reporting success',()=>{
 assert.match(migration,/hash\(verified.bytes\)===checksum/);
 assert.doesNotMatch(migration,/method:\s*['\"]DELETE['\"]/);
});
test('cloud generation verifies R2 before atomically settling the job',()=>{
 assert.match(imageCloud,/saveGeneratedMedia/);
 assert.match(imageCloud,/rpc\('finish_media'/);
 assert.doesNotMatch(imageCloud,/storage\/v1\/object\/loox-results/);
});

test('worker reference images use expiring authenticated proxy URLs',async()=>{
 const {workerInputURL}=await import('../lib/media-store.js');
 const {createHmac}=await import('node:crypto');
 const key='users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/inputs/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-reference_image.png';
 const saved=process.env.LOOX_IDENTITY_SECRET;
 const base=process.env.LOOX_BACKEND_URL;
 process.env.LOOX_IDENTITY_SECRET='a'.repeat(64);
 process.env.LOOX_BACKEND_URL='https://looxtoolfree-backend.vercel.app';
 try {
  const url=new URL(workerInputURL(key,600));
  assert.equal(url.origin,'https://looxtoolfree-backend.vercel.app');
  assert.equal(url.pathname,'/api/local-worker');
  assert.equal(url.searchParams.get('action'),'input');
  assert.equal(url.searchParams.get('path'),key);
  const exp=Number(url.searchParams.get('exp'));
  assert.ok(exp>Math.floor(Date.now()/1000)+580&&exp<Math.floor(Date.now()/1000)+620);
  const expected=createHmac('sha256',process.env.LOOX_IDENTITY_SECRET)
    .update('worker-media:'+key+':'+exp).digest('hex');
  assert.equal(url.searchParams.get('sig'),expected);
  assert.throws(()=>workerInputURL('users/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/inputs/../../foreign.png',600));
 }finally{
  if(saved==null)delete process.env.LOOX_IDENTITY_SECRET;else process.env.LOOX_IDENTITY_SECRET=saved;
  if(base==null)delete process.env.LOOX_BACKEND_URL;else process.env.LOOX_BACKEND_URL=base;
 }
});
test('bundled Windows worker accepts signed backend input links',()=>{
 const worker=readFileSync(new URL('../local-worker/loox-worker.py',import.meta.url),'utf8');
 assert.match(worker,/allowed_worker_proxy/);
 assert.match(worker,/parsed.path == "\/api\/local-worker"/);
 assert.match(worker,/args.get\("action"\) == \["input"\]/);
});
test('R2 uploads use accepted keys and admin-only template purpose',()=>{
 const gateway=readFileSync(new URL('../lib/r2-media.js',import.meta.url),'utf8');
 assert.match(gateway,/userKey\(user.id,'community',id,'image\/webp'\)/);
 assert.match(gateway,/public\/templates\//);
 assert.match(gateway,/loox_template_admin===true/);
 assert.match(gateway,/makeThumbnail\(bytes\)/);
});

test('R2 template videos require admin, size, checksum and a scoped private upload',()=>{
 const gateway=readFileSync(new URL('../lib/r2-media.js',import.meta.url),'utf8');
 assert.match(gateway,/template_video_prepare/);
 assert.match(gateway,/loox_template_admin===true/);
 assert.match(gateway,/presignR2Object\('PUT',path/);
 assert.match(gateway,/info.sha256===sha256/);
});
test('chat attachments verify thread ownership and use private R2 objects',()=>{
 const chat=readFileSync(new URL('../lib/chat-attachments.js',import.meta.url),'utf8');
 assert.match(chat,/user_id:'eq.'\+user.id/);
 assert.match(chat,/userKey\(user.id,'chat',id,'image\/webp'\)/);
 assert.match(chat,/presignR2Object\('GET',row.object_key/);
 assert.match(chat,/deleteR2Object\(found.object_key\)/);
});
