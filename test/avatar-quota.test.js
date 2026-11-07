import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
test('avatar upload gate counts existing files, enforces quota and excludes browser execution',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema storage;create schema loox_private;create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema loox_private to service_role;create table storage.objects(bucket_id text,name text,metadata jsonb);create function storage.foldername(text) returns text[] language sql as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;alter table storage.objects enable row level security;create policy upload_own_avatar on storage.objects for insert to authenticated with check(true);`);
 await db.exec(await readFile(new URL('../supabase/avatar-storage-quota.sql',import.meta.url),'utf8'));const id=randomUUID();await db.exec('set role service_role');assert.equal((await db.query('select loox_avatar_quota($1) as q',[id])).rows[0].q.allowed,true);await db.exec('reset role');
 await db.query("insert into storage.objects select 'loox-avatars',$1||'/'||n||'.webp','{\"size\":1000}'::jsonb from generate_series(1,20) n",[id]);await db.exec('set role service_role');assert.equal((await db.query('select loox_avatar_quota($1) as q',[id])).rows[0].q.allowed,false);await db.exec('reset role;set role authenticated');await assert.rejects(db.query('select loox_avatar_quota($1)',[id]),/permission denied/);
 }finally{await db.close();}
});
