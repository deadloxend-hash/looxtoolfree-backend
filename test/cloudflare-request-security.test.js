import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/loox-profile-api.js';
const id='11111111-1111-4111-8111-111111111111';
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture-public',DB:{prepare(sql){return {bind(){return this;},async first(){return null;},async run(){return {meta:{changes:1}};}};}}};
const token=aal=>'Bearer '+Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,iss:env.SUPABASE_URL+'/auth/v1',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,aal})).toString('base64url')+'.fixture-signature';
const fixture={id,email_confirmed_at:'2026-01-01T00:00:00Z',factors:[{status:'verified'}]};
test('real Worker rejects ordinary MFA-enrolled password-only sessions before reading private records',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json(fixture));
 const res=await worker.fetch(new Request('https://loox-profile-api.looxai-studio.workers.dev/v1/notifications',{headers:{Authorization:token('aal1')}}),env);
 assert.equal(res.status,403);assert.match((await res.json()).error,/authenticator/);
 assert.equal(res.headers.get('Strict-Transport-Security'),'max-age=31536000');assert.match(res.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
});
test('real Worker bounds JSON streams and rejects malformed content before executing a mutation',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json(fixture));
 for(const [body,type,status] of [['{}','text/plain',415],['[]','application/json',400],['{bad','application/json',400],[JSON.stringify({text:'a'.repeat(65536)}),'application/json',413]]){
  const res=await worker.fetch(new Request('https://loox-profile-api.looxai-studio.workers.dev/v1/privacy',{method:'PATCH',headers:{Authorization:token('aal2'),'Content-Type':type},body}),env);
  assert.equal(res.status,status);assert.equal(res.headers.get('Cache-Control'),'no-store');
 }
});
test('pre-authentication IP budget rejects abuse without contacting the authentication provider',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Must not reach Auth');});
 const database={prepare(){return {bind(){return this;},async run(){return {meta:{changes:0}};}};}};
 const res=await worker.fetch(new Request('https://loox-profile-api.looxai-studio.workers.dev/v1/notifications',{headers:{Authorization:token('aal2'),'CF-Connecting-IP':'192.0.2.1'}}),{...env,DB:database});
 assert.equal(res.status,429);assert.equal(calls,0);
});

test('profile upload headers reject oversized dimensions and animated PNG without decoding pixels',async()=>{
 const {profileImageDimensions}=await import('../cloudflare/loox-profile-api.js');
 const png=new Uint8Array(45),v=new DataView(png.buffer);v.setUint32(8,13);png.set(new TextEncoder().encode('IHDR'),12);v.setUint32(16,100);v.setUint32(20,100);
 assert.deepEqual(profileImageDimensions(png,'image/png'),{width:100,height:100});
 v.setUint32(16,100000);assert.throws(()=>profileImageDimensions(png,'image/png'),/dimensions/);v.setUint32(16,100);
 png.set(new TextEncoder().encode('acTL'),37);assert.throws(()=>profileImageDimensions(png,'image/png'),/Animated/);
 assert.throws(()=>profileImageDimensions(new Uint8Array(14),'image/webp'),/dimensions/);
});
