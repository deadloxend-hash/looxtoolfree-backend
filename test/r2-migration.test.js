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
 assert.match(migration,/hash\(bytes\)===hash\(verified.bytes\)/);
 assert.doesNotMatch(migration,/method:\s*['\"]DELETE['\"]/);
});
test('cloud generation preserves original while mirroring to R2',()=>{
 assert.match(imageCloud,/putR2Object\(u.id\+'\/generations\/'.*png/);
 assert.match(imageCloud,/rpc\('finish'/);
});
