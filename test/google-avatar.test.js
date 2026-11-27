import test from 'node:test';import assert from 'node:assert/strict';import {googleAvatar} from '../lib/google-avatar.js';
test('Google avatar proxy accepts only own Google identity pictures on fixed HTTPS hosts and bounds streams',async()=>{
 let calls=0;const user=url=>({identities:[{provider:'google',identity_data:{picture:url}}]});
 const request=async()=>{calls++;const b=new Uint8Array(45);b.set([137,80,78,71,13,10,26,10]);const view=new DataView(b.buffer);view.setUint32(8,13);b.set(new TextEncoder().encode('IHDR'),12);view.setUint32(16,100);view.setUint32(20,100);return new Response(b,{headers:{'Content-Type':'image/png'}});};
 for(const url of ['http://lh3.googleusercontent.com/a/photo','https://lh3.googleusercontent.com.evil.example/a/photo','https://user@lh3.googleusercontent.com/a/photo','https://127.0.0.1/a/photo','https://lh3.googleusercontent.com/other/path'])await assert.rejects(googleAvatar(user(url),{request}));assert.equal(calls,0);
 assert.equal((await googleAvatar(user('https://lh3.googleusercontent.com/a/photo'),{request})).mime,'image/png');
 await assert.rejects(googleAvatar(user('https://lh3.googleusercontent.com/a/photo'),{request:async()=>new Response(new Uint8Array(524289),{headers:{'Content-Type':'image/png'}})}),e=>e.status===413);
 await assert.rejects(googleAvatar(user('https://lh3.googleusercontent.com/a/photo'),{request:async()=>new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}})}),e=>e.status===415);
});
