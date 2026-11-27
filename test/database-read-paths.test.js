import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const migration=new URL('../supabase/migrations/20261127182100_cache_template_policy_auth_claims.sql',import.meta.url);
test('cached policy claims preserve public browsing, deny ordinary/password-only admin writes and allow MFA admins',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create role anon;create role authenticated;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 grant usage on schema auth to anon,authenticated;
 create table loox_template_catalog(id text primary key,active boolean);create table loox_template_categories(id text primary key);create table loox_template_styles(id text primary key);
 alter table loox_template_catalog enable row level security;alter table loox_template_categories enable row level security;alter table loox_template_styles enable row level security;
 grant select,insert,update,delete on loox_template_catalog,loox_template_categories,loox_template_styles to authenticated;grant select on loox_template_catalog to anon;
 create policy browse_original_templates on loox_template_catalog for select to anon,authenticated using(active);
 insert into loox_template_catalog values('public',true),('private',false);`);
 const expression="(coalesce(auth.jwt()->'app_metadata'->>'loox_template_admin','false')='true' and auth.jwt()->>'aal'='aal2')";
 for(const [table,policy,cmd] of [['loox_template_catalog','loox_admin_catalog_insert','insert'],['loox_template_catalog','loox_admin_catalog_read','select'],['loox_template_catalog','loox_admin_catalog_update','update'],['loox_template_catalog','loox_admin_catalog_delete','delete'],['loox_template_categories','admin_add_categories','insert'],['loox_template_categories','admin_edit_categories','update'],['loox_template_categories','admin_delete_categories','delete'],['loox_template_styles','admin_add_styles','insert'],['loox_template_styles','admin_delete_styles','delete']])await db.exec(`create policy ${policy} on ${table} for ${cmd} to authenticated `+(cmd!=='insert'?`using(${expression}) `:'')+(['insert','update'].includes(cmd)?`with check(${expression})`:''));
 const claims=[{aal:'aal1',app_metadata:{}},{aal:'aal2',app_metadata:{}},{aal:'aal1',app_metadata:{loox_template_admin:true}},{aal:'aal2',app_metadata:{loox_template_admin:true}}];
 async function permissions(){const results=[];for(const claim of claims){await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(claim)]);await db.exec('set role authenticated');results.push(Number((await db.query('select count(*) as n from loox_template_catalog')).rows[0].n));try{await db.query("insert into loox_template_catalog values('attempt',false)");results.push(true);}catch{results.push(false);}await db.exec('reset role');await db.exec("delete from loox_template_catalog where id='attempt'");}return results;}
 const before=await permissions();await db.exec(await readFile(migration,'utf8'));assert.deepEqual(await permissions(),before);assert.deepEqual(before,[1,false,1,false,1,false,2,true]);
 await db.exec("set role anon;select set_config('request.jwt.claims','{}',false)");assert.equal(Number((await db.query('select count(*) as n from loox_template_catalog')).rows[0].n),1);await db.exec('reset role');
 const plan=await db.query('explain select * from loox_template_catalog');assert.ok(plan.rows.length>0);
 }finally{await db.close();}
});
test('new covering indexes are additive and preserve composite index coverage already present',async()=>{
 const sql=await readFile(new URL('../supabase/migrations/20261127182000_remaining_foreign_key_indexes.sql',import.meta.url),'utf8');assert.equal((sql.match(/create index if not exists/g)||[]).length,16);assert.doesNotMatch(sql,/\b(drop|truncate|delete from|update public|grant)\s/i);
 const db=new PGlite();try{
 const matches=[...sql.matchAll(/create index if not exists (\w+) on public\.(\w+)\((\w+)\)/g)];for(const table of new Set(matches.map(m=>m[2]))){const cols=matches.filter(m=>m[2]===table).map(m=>m[3]+' uuid').join(',');await db.exec(`create table public.${table}(${cols})`);}await db.exec(sql);
 const result=await db.query("select count(*) as n from pg_indexes where schemaname='public' and indexname like '%_fk_cover'");assert.equal(Number(result.rows[0].n),16);
 await db.exec(sql);assert.equal(Number((await db.query("select count(*) as n from pg_indexes where schemaname='public' and indexname like '%_fk_cover'")).rows[0].n),16);
 }finally{await db.close();}
});
