import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
test('original templates browse without credits, saved records stay private, disabled presets cannot launch',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/original-template-catalog.sql',import.meta.url),'utf8'));
 const u=randomUUID(),v=randomUUID();await db.query('insert into auth.users values($1),($2)',[u,v]);await db.exec('set role anon');assert.equal((await db.query('select count(*)::int n from loox_template_catalog')).rows[0].n,40);await assert.rejects(db.query('select * from loox_saved_templates'),/permission denied/);
 await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u]);await db.query("insert into loox_saved_templates(user_id,template_id) values($1,'moonlit-samurai')",[u]);await db.exec("select loox_launch_template('moonlit-samurai');select loox_launch_template('moonlit-samurai')");assert.equal((await db.query('select count(*)::int n from loox_template_launches')).rows[0].n,1);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[v]);assert.equal((await db.query('select count(*)::int n from loox_saved_templates')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from loox_template_launches')).rows[0].n,0);
 await db.exec("reset role;update loox_template_catalog set active=false where id='moonlit-samurai';set role authenticated;");await assert.rejects(db.exec("select loox_launch_template('moonlit-samurai')"),/unavailable/);
 }finally{await db.close();}
});
