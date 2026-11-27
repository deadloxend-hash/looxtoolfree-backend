import test from 'node:test';import assert from 'node:assert/strict';
import {verifyRecentOAuth} from '../lib/oauth-reauth.js';
import {manageAuthenticator} from '../lib/auth-factors.js';
import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333';
test('OAuth reauthentication requires a recent signed AMR, matching identity, MFA, live session and atomic receipt',async()=>{
 const user={id:A,identities:[{provider:'google'}]},now=Date.now(),claims={sub:A,session_id:S,aal:'aal1',amr:[{method:'oauth',timestamp:now/1000}]};let calls=0;
 const options={now,call:async(name,b)=>{assert.equal(name,'consume_recent_oauth');assert.equal(b.p_user,A);assert.equal(b.p_session,S);assert.equal(b.p_purpose,'export');calls++;return calls===1;}};
 await verifyRecentOAuth(user,claims,'export',options);await assert.rejects(verifyRecentOAuth(user,claims,'export',options),/already used/);
 for(const bad of [{...claims,sub:B},{...claims,amr:[{method:'oauth',timestamp:now/1000-301}],iat:now/1000},{...claims,amr:[{method:'oauth',timestamp:now/1000+60}]},{...claims,amr:[{method:'password',timestamp:now/1000}]}])await assert.rejects(verifyRecentOAuth(user,bad,'export',options));
 await assert.rejects(verifyRecentOAuth({...user,factors:[{status:'verified'}]},claims,'export',options),/authenticator/);assert.equal(calls,2);
});
test('OAuth reauth RPC rejects cross-owner, old and revoked sessions, enforces MFA and serializes replay',async()=>{
 const db=new PGlite();try{await db.exec(`create schema auth;create schema loox_private;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz,not_after timestamptz,aal text);create table auth.mfa_factors(user_id uuid,status text);insert into auth.users values('${A}'),('${B}');insert into auth.sessions values('${S}','${A}',now(),null,'aal1');grant usage on schema public,loox_private to anon,authenticated,service_role;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261127122225_single_use_oauth_security_verification.sql',import.meta.url),'utf8'));
 const consume=(owner=A,purpose='export')=>db.query('select public.loox_consume_recent_oauth($1,$2,$3) as ok',[owner,S,purpose]);
 assert.equal((await consume(B)).rows[0].ok,false);const r=await Promise.all([consume(),consume()]);assert.equal(r.filter(x=>x.rows[0].ok).length,1);
 await db.exec(`update auth.sessions set created_at=now()-interval '1 hour'`);assert.equal((await consume(A,'delete')).rows[0].ok,false);
 await db.exec(`update auth.sessions set created_at=now(),not_after=now()-interval '1 second'`);assert.equal((await consume(A,'delete')).rows[0].ok,false);
 await db.exec(`update auth.sessions set not_after=null;insert into auth.mfa_factors values('${A}','verified')`);assert.equal((await consume(A,'delete')).rows[0].ok,false);
 await db.exec(`update auth.sessions set aal='aal2'`);assert.equal((await consume(A,'delete')).rows[0].ok,true);
 await db.exec('set role authenticated');await assert.rejects(consume(A,'sessions'),/permission denied/);await assert.rejects(db.query('select * from public.loox_oauth_reauth_receipts'),/permission denied/);
 }finally{await db.close();}
});
test('authenticator removal checks own factor and MFA before reauthentication or provider requests',async()=>{
 let calls=0;const deps={read:async()=>[],verify:async()=>{calls++},request:async()=>{calls++;return {ok:true,json:async()=>({id:S})}}};
 await assert.rejects(manageAuthenticator({id:A,factors:[]},{operation:'remove',factorId:S},{aal:'aal2'},'Bearer fixture',deps));assert.equal(calls,0);
 assert.deepEqual(await manageAuthenticator({id:A,factors:[{id:S,factor_type:'totp',status:'verified'}]},{operation:'remove',factorId:S},{aal:'aal2'},'Bearer fixture',deps),{removed:true});assert.equal(calls,2);
});
