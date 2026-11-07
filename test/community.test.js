import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('community publishing, moderation, likes, follows, privacy and account isolation against PostgreSQL',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create schema storage;create role anon;create role authenticated;create role service_role bypassrls;
 create table auth.users(id uuid primary key,raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
 grant usage on schema auth,storage to anon,authenticated;
 create table public.loox_profiles(user_id uuid primary key references auth.users(id),name text,terms_version text);
 create table public.loox_jobs(id uuid primary key,user_id uuid references public.loox_profiles(user_id),request_id uuid,digest text,operation text,cost integer,state text,result_path text,prompt text);
 alter table public.loox_jobs enable row level security;grant select on public.loox_jobs to authenticated;
 create policy own_jobs on public.loox_jobs to authenticated using(user_id=auth.uid());
 create table public.loox_media_entries(id uuid,session_id uuid,user_id uuid,request_id uuid,media_type text,created_at timestamptz);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,bucket_id text,name text);
 alter table storage.objects enable row level security;grant select,insert on storage.objects to anon,authenticated;
 create function storage.foldername(text) returns text[] language sql as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;`);
 await db.exec(await readFile(new URL('../supabase/community-templates.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/creative-community.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/community-platform.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/community-rpc-hardening.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../tests/community-rls.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../tests/community-platform.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0,'fixture writes rolled back');
 }finally{await db.close();}
});
