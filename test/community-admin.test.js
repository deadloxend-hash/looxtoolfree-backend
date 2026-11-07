import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
test('admin credit adjustments require server role, verified admin and idempotent audited transactions',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create schema storage;create schema loox_private;create role anon;create role authenticated;create role service_role bypassrls;
 create table auth.users(id uuid primary key,raw_app_meta_data jsonb,created_at timestamptz default now());
 create table public.loox_creator_profiles(user_id uuid);
 create table public.loox_community_posts(id uuid,creator_id uuid,status text,visible boolean);
 create table public.loox_template_submissions(id uuid,status text,visible boolean);
 create table public.loox_content_reports(id uuid primary key,post_id uuid,comment_id uuid,reason text,status text);
 create table public.loox_post_comments(id uuid,post_id uuid);
 create table public.loox_jobs(id uuid,state text);
 create table public.loox_wallets(user_id uuid primary key,balance int not null check(balance>=0),debt int not null default 0);
 create table public.loox_credits(user_id uuid,reason text,amount int,reference text,unique(user_id,reason,reference));
 create table public.loox_moderation_log(admin_id uuid,post_id uuid,action text,reason text);
 create table public.loox_spend(millicents bigint);
 create table storage.objects(metadata jsonb);`);
 await db.exec(await readFile(new URL('../supabase/community-admin.sql',import.meta.url),'utf8'));
 const admin=randomUUID(),member=randomUUID(),request=randomUUID();await db.query('insert into auth.users(id,raw_app_meta_data) values($1,$2),($3,$4)',[admin,{loox_template_admin:true},member,{}]);await db.query('insert into loox_wallets(user_id,balance) values($1,20)',[member]);
 await db.exec('set role authenticated');await assert.rejects(db.query('select loox_admin_overview()'),/permission denied/);await assert.rejects(db.query('select loox_admin_adjust_credits($1,$2,50,$3,$4)',[admin,member,'Admin test',request]),/permission denied/);
 await db.exec('reset role;set role service_role');
 await assert.rejects(db.query('select loox_admin_adjust_credits($1,$2,50,$3,$4)',[member,member,'Admin test',request]),/Administrator access required/);
 const adjust=amount=>db.query('select loox_admin_adjust_credits($1,$2,$3,$4,$5) as v',[admin,member,amount,'Admin test',request]);
 assert.equal((await adjust(50)).rows[0].v.balance,70);assert.equal((await adjust(50)).rows[0].v.duplicate,true);await assert.rejects(adjust(51),/already used/);
 await assert.rejects(db.query('select loox_admin_adjust_credits($1,$2,-100,$3,$4)',[admin,member,'Too much reduction',randomUUID()]),/invalid balance/);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from loox_credits')).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from loox_moderation_log')).rows[0].n,1);
 }finally{await db.close();}
});
