import test from 'node:test';
import assert from 'node:assert/strict';
import {completeDataExport,deletePrivateAccount,securitySummary} from '../lib/privacy.js';
import {env} from '../lib/core.js';
const A='00000000-0000-4000-8000-000000000001',S='00000000-0000-4000-8000-000000000003';
const user={id:A,email:'owner@example.com'},claims={session_id:S,aal:'aal1'};
test('full export uses a session-bound proof, own prefixes and private file signatures without exporting authorization',async()=>{
 const previous=env.SUPABASE_URL;env.SUPABASE_URL='https://project.supabase.co';let seenProof=false,inventory=0;
 try{
 const data=await completeDataExport(user,'fixture-password',claims,'Bearer secret-never-export',{
 verify:async()=>{},collect:async()=>({account:{id:A},records:{}}),
 call:async(name,b)=>{assert.equal(b.p_user,A);if(name==='security_summary')return {sessions:[],activity:[]};if(name==='issue_privacy_proof'){assert.equal(b.p_session,S);assert.match(b.p_hash,/^[a-f0-9]{64}$/);seenProof=true;return;}if(name==='account_storage_inventory')return inventory++?[]:[{bucket_id:'loox-results',name:A+'/old.png',bytes:3}];throw Error(name);},
 request:async(url,opts)=>{assert.equal(seenProof,true);assert.equal(opts.headers.Authorization,'Bearer secret-never-export');assert.equal(JSON.parse(opts.body).proof.length,43);return {ok:true,json:async()=>({records:{profile:[{user_id:A}]},media:[{key:'users/'+A+'/generations/new.png',bytes:3}]})};},
 sign:(method,key,opts)=>{assert.equal(method,'GET');assert.ok(key.startsWith('users/'+A+'/'));assert.equal(opts.expires,300);assert.equal(opts.downloadName,'new.png');return 'https://example.r2.cloudflarestorage.com/looxai/'+key+'?signature=temporary';},
 storage:async(path)=>{assert.ok(path.includes(A+'/old.png'));return {signedURL:'/object/sign/loox-results/'+A+'/old.png?token=temporary-file-lease'};}
 });
 assert.equal(data.format,'loox-personal-data-v2');assert.equal(data.media.length,2);assert.equal(data.cloudflare.profile[0].user_id,A);assert.ok(!JSON.stringify(data).includes('secret-never-export'));
 }finally{if(previous===undefined)delete env.SUPABASE_URL;else env.SUPABASE_URL=previous;}
});
test('foreign media and missing native sessions fail closed',async()=>{
 await assert.rejects(securitySummary(user,{},{}),e=>e.status===401);
 await assert.rejects(completeDataExport(user,'fixture-password',claims,'Bearer fixture',{
 verify:async()=>{},collect:async()=>({account:{id:A}}),call:async()=>[],request:async()=>({ok:true,json:async()=>({records:{},media:[{key:'users/someone-else/generations/file.png'}]})}),sign:()=>{throw Error('must not sign');}
 }),e=>e.status===503);
});
test('billing/admin review blocks deletion before any cleanup or account state mutation',async()=>{
 let called=false;
 await assert.rejects(deletePrivateAccount(user,'fixture-password',claims,'Bearer fixture',{
 verify:async()=>{},summary:async()=>({deletion:{requires_support:true}}),call:async()=>{called=true},request:async()=>{called=true},storage:async()=>{called=true}
 }),e=>e.status===409);assert.equal(called,false);
});
test('deletion cleans both stores and revokes sessions before deleting identity; retries retain identity on failure',async()=>{
 const calls=[];let inventory=0;
 const deps={verify:async()=>calls.push('verify'),summary:async()=>({deletion:{requires_support:false}}),
 call:async(name,b)=>{assert.equal(b.p_user,A);calls.push(name);return name==='account_storage_inventory'?(inventory++?[]:[{bucket_id:'loox-results',name:A+'/legacy.png'},{bucket_id:'loox-avatars',name:A+'/avatar.png'}]):null;},
 request:async(url,opts)=>{calls.push(url.includes('account-delete')?'cloud-delete':'revoke');if(url.includes('account-delete'))assert.equal(JSON.parse(opts.body).proof.length,43);assert.equal(opts.headers.Authorization,'Bearer fixture');return {ok:true,json:async()=>({complete:true})};},
 storage:async(path,opts)=>{calls.push(path.startsWith('/auth/')?'identity-delete':'legacy-delete');if(path.startsWith('/storage/'))assert.ok(JSON.parse(opts.body).prefixes.every(k=>k.startsWith(A+'/')));}
 };
 assert.equal((await deletePrivateAccount(user,'fixture-password',claims,'Bearer fixture',deps)).deleted,true);
 assert.ok(calls.indexOf('cloud-delete')<calls.indexOf('legacy-delete'));assert.ok(calls.indexOf('revoke')<calls.indexOf('identity-delete'));assert.equal(calls.at(-1),'identity-delete');
 let deleted=false;await assert.rejects(deletePrivateAccount(user,'fixture-password',claims,'Bearer fixture',{
 ...deps,call:async()=>null,request:async()=>({ok:true,json:async()=>({complete:false})}),storage:async()=>{deleted=true}
 }),e=>e.status===409);assert.equal(deleted,false);
});
