import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
test('Control Center preserves records, enforces roles, isolates support notes, and audits atomic changes',async()=>{
 const db=new PGlite();try{
 await db.exec(`create schema auth;create schema storage;create table storage.buckets(id text,name text,public boolean);create schema loox_private;create role anon;create role authenticated;create role service_role bypassrls;create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz,raw_app_meta_data jsonb);create table auth.sessions(id uuid,user_id uuid,not_after timestamptz);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 await db.exec(await readFile(new URL('../supabase/platform.sql',import.meta.url),'utf8'));
 await db.exec(`create table loox_recharge_payments(amount_cents int,status text,currency text,created_at timestamptz);create table loox_provider_costs(estimated_millicents bigint,actual_millicents bigint,created_at timestamptz);create table loox_security_alerts(id uuid primary key);create table loox_cost_controls(id boolean primary key,disabled_operations text[] default '{}');insert into loox_cost_controls(id) values(true);
 create table loox_template_categories(name text primary key,created_at timestamptz default now());create table loox_template_styles(name text primary key,created_at timestamptz default now());
 create table loox_template_catalog(id text primary key,title text,description text,prompt text,kind text,category text,model_id text,settings jsonb,author text,license text,active boolean,media_path text,media_provider text,media_key text,thumbnail_key text,media_type text,style text,styles text[],updated_at timestamptz);
 grant usage on schema loox_private to service_role;grant select,insert,update on all tables in schema public to service_role;grant usage,select on all sequences in schema public to service_role;`);
 const owner=randomUUID(),member=randomUUID(),support=randomUUID();await db.query('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3),($4,$5,$6),($7,$8,$9)',[owner,'owner@example.test',{loox_template_admin:true},member,'customer@example.test',{},support,'support@example.test',{}]);
 await db.exec(await readFile(new URL('./fixtures/control-center.sql',import.meta.url),'utf8'));
 assert.equal((await db.query("select count(*)::int n from loox_admin_roles where role='owner'")).rows[0].n,1);
 await db.query("select loox_account($1,'Existing customer','unique','2026-11')",[member]);const before=(await db.query('select balance from loox_wallets where user_id=$1',[member])).rows[0].balance;
 await db.exec('set role authenticated');await assert.rejects(db.query('select loox_control_users()'),/permission denied/);await assert.rejects(db.query('select * from loox_support_messages'),/permission denied/);await db.exec('reset role');
 await db.query("insert into loox_admin_roles(user_id,role) values($1,'support')",[support]);await db.exec('set role service_role');
 const change=(actor,request,data={suspended:true})=>db.query("select loox_control_mutate($1,'restriction',$2,'Abuse investigation',$3,$4) as result",[actor,member,request,data]);
 await assert.rejects(change(member,randomUUID()),/Permission denied/);await assert.rejects(change(support,randomUUID()),/Permission denied/);
 const key=randomUUID();await change(owner,key);assert.equal((await change(owner,key)).rows[0].result.duplicate,true);await assert.rejects(change(owner,key,{suspended:false}),/Idempotency conflict/);
 assert.equal((await db.query('select balance from loox_wallets where user_id=$1',[member])).rows[0].balance,before);
 await assert.rejects(db.query("update loox_admin_audit set reason='Modified'"),/permission denied|immutable/);
 const ticket=randomUUID();await db.query("select loox_support_create($1,'Missing credits','missing_credits','Please investigate','test-ref',$2)",[member,ticket]);
 await db.query("select loox_control_mutate($1,'ticket_reply',$2,'Investigation note',$3,$4)",[support,ticket,randomUUID(),{body:'Internal billing evidence',internal:true}]);
 assert.equal((await db.query('select count(*)::int n from loox_support_messages where ticket_id=$1 and not internal',[ticket])).rows[0].n,1);
 await db.query("select loox_control_mutate($1,'model_pause','generate','Temporary safety pause',$2,$3)",[owner,randomUUID(),{paused:true}]);
 assert.deepEqual((await db.query('select disabled_operations from loox_cost_controls')).rows[0].disabled_operations,['generate']);
 const overview=(await db.query("select loox_control_overview(now()-interval '7 days',now()) as data")).rows[0].data;assert.equal(overview.registered_users,3);assert.equal(overview.open_tickets,1);
 const search=(await db.query("select loox_control_users('customer',1,'','') as data")).rows[0].data;assert.equal(search.total,1);assert.equal(search.items[0].id,member);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from loox_admin_audit')).rows[0].n,3);await db.query('delete from auth.users where id=$1',[member]);assert.equal((await db.query('select count(*)::int n from loox_support_tickets')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from loox_admin_audit')).rows[0].n,3);
 }finally{await db.close();}
});
