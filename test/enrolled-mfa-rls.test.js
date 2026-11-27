import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('restrictive MFA policy blocks direct account reads and writes at aal1, preserves unenrolled accounts, public browsing and service access',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema loox_private;
 create function auth.uid() returns uuid language sql as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
 create table auth.mfa_factors(user_id uuid,status text);
 create schema storage;grant usage on schema storage to anon,authenticated,service_role;
 create table storage.objects(owner_id uuid);alter table storage.objects enable row level security;
 grant select on storage.objects to authenticated,service_role;
 create policy own_objects on storage.objects to authenticated using(owner_id=auth.uid());
 insert into storage.objects values('11111111-1111-4111-8111-111111111111');
 create table public.owned_notes(user_id uuid primary key,body text);alter table public.owned_notes enable row level security;
 grant usage on schema public,auth,loox_private to anon,authenticated,service_role;
 grant select,update on public.owned_notes to authenticated;grant all on public.owned_notes to service_role;
 create policy owner_notes on public.owned_notes to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
 create table public.public_catalog(id int);insert into public.public_catalog values(1);alter table public.public_catalog enable row level security;
 grant select on public.public_catalog to anon,authenticated;create policy browse_catalog on public.public_catalog for select to anon,authenticated using(true);
 insert into auth.mfa_factors values('11111111-1111-4111-8111-111111111111','verified');
 insert into public.owned_notes values('11111111-1111-4111-8111-111111111111','A'),('22222222-2222-4222-8222-222222222222','B');`);
 const migration=readFileSync(new URL('../supabase/migrations/20261127114635_enforce_enrolled_mfa_for_data_api.sql',import.meta.url),'utf8');await db.exec(migration);
 const claims=async(sub,aal)=>db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub,aal})]);
 await claims('11111111-1111-4111-8111-111111111111','aal1');await db.exec('set role authenticated');
 assert.equal((await db.query('select count(*)::int as n from public.owned_notes')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,0);
 assert.equal((await db.query("update public.owned_notes set body='blocked' returning body")).rows.length,0);
 await claims('11111111-1111-4111-8111-111111111111','aal2');assert.equal((await db.query('select body from public.owned_notes')).rows[0].body,'A');
 assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,1);
 await claims('22222222-2222-4222-8222-222222222222','aal1');assert.equal((await db.query('select body from public.owned_notes')).rows[0].body,'B');
 await db.exec('reset role;set role anon');assert.equal((await db.query('select count(*)::int as n from public.public_catalog')).rows[0].n,1);await assert.rejects(db.query('select * from public.owned_notes'));
 await db.exec('reset role;set role service_role');assert.equal((await db.query('select count(*)::int as n from public.owned_notes')).rows[0].n,2);
 }finally{await db.close();}
});
