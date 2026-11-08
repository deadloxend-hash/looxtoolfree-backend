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

test('worker reference images use real private R2 presigned GET URLs',()=>{
 const store=readFileSync(new URL('../lib/media-store.js',import.meta.url),'utf8');
 assert.match(store,/presignR2Object\('GET',key,\{expires\}\)/);
 assert.doesNotMatch(store,/new URL\('\/storage\/v1\/object\/sign\/loox-results/);
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
