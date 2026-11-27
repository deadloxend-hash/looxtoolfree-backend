// Disposable loopback PostgreSQL only. Never uses Supabase or production secrets.
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
assert.equal(process.env.LOOX_RECOVERY_DRILL,'isolated-fixture','Explicit synthetic drill mode required');
const port=Number(process.env.LOOX_DRILL_PORT||5432);assert.ok(Number.isInteger(port)&&port>0&&port<65536);
const source='loox_drill_source',target='loox_drill_target',user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333';
const connection=name=>{const u=new URL('postgresql://127.0.0.1:'+port+'/'+name);u.username='postgres';u.password=process.env.PGPASSWORD||'';return u.href;};
const environment={...process.env,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGSSLMODE:'disable'};
function sql(name,statement,{allowError=false}={}){const r=spawnSync('psql',['--no-psqlrc','--tuples-only','--no-align','--set','ON_ERROR_STOP=1','--dbname',name,'--command',statement],{env:environment,encoding:'utf8'});if(!allowError)assert.equal(r.status,0,'Synthetic PostgreSQL fixture command failed: '+r.stderr);return r;}
assert.equal(sql('postgres',"select count(*) from pg_database where datname in ('loox_drill_source','loox_drill_target')").stdout.trim(),'0','Drill requires new disposable databases');
sql('postgres','create database '+source);sql('postgres','create database '+target);
sql(source,`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;create table storage.buckets(id text,name text,public boolean);`);
sql(source,readFileSync(new URL('../supabase/platform.sql',import.meta.url),'utf8'));
sql(source,readFileSync(new URL('../supabase/migrations/20261114033906_billing_security_foundation.sql',import.meta.url),'utf8'));
sql(source,`insert into auth.users values('${user}'),('${other}');select loox_account('${user}','Synthetic A','fixture-a','2026-11');select loox_account('${other}','Synthetic B','fixture-b','2026-11');select loox_reserve('${user}','${job}','synthetic-recovery','generate',25,9999999);select loox_finish((select id from loox_jobs where user_id='${user}' and request_id='${job}'),null);`);
const snapshot=name=>sql(name,`select json_build_object('users',(select count(*) from auth.users),'profiles',(select count(*) from loox_profiles),'wallets',(select count(*) from loox_wallets),'wallet_total',(select sum(balance-debt) from loox_wallets),'ledger_total',(select sum(amount) from loox_credits),'jobs',(select count(*) from loox_jobs),'rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity),'protected_wallet',(select relrowsecurity from pg_class where oid='loox_wallets'::regclass))`).stdout.trim();
const before=snapshot(source),folder=mkdtempSync(join(tmpdir(),'loox-synthetic-recovery-')),backup=join(folder,'fixture.looxbackup');
const runtime={...environment,SUPABASE_DB_URL:connection(source),LOOX_RESTORE_DB_URL:connection(target),LOOX_RESTORE_ISOLATED:'true',LOOX_BACKUP_SSLMODE:'disable',LOOX_BACKUP_KEY:randomBytes(32).toString('base64')};
function cli(action,extra={},fail=false){const r=spawnSync(process.execPath,['scripts/database-backup.mjs',action,backup],{env:{...runtime,...extra},encoding:'utf8'});if(fail)assert.notEqual(r.status,0,'Unsafe restore attempt must fail');else assert.equal(r.status,0,'Synthetic backup command failed: '+r.stderr);return r;}
try{
 cli('capture');cli('verify');cli('restore-isolated',{LOOX_BACKUP_KEY:randomBytes(32).toString('base64')},true);
 assert.equal(sql(target,"select count(*) from pg_tables where schemaname='public'").stdout.trim(),'0');
 assert.match(cli('restore-isolated',{LOOX_RESTORE_DB_URL:connection(source)},true).stderr,/source database/);
 assert.equal(snapshot(source),before,'Refused restore must not change its source');
 cli('restore-isolated');assert.equal(snapshot(target),before);
 const visible=sql(target,`set role authenticated;select set_config('request.jwt.claim.sub','${other}',false);select count(*) from loox_wallets where user_id='${user}';`).stdout.trim().split('\n').at(-1);assert.equal(visible,'0');
 assert.notEqual(sql(target,"set role authenticated;update loox_wallets set balance=999;",{allowError:true}).status,0);
 assert.match(cli('restore-isolated',{},true).stderr,/empty public schema/);assert.equal(snapshot(target),before);
 console.log(JSON.stringify({synthetic:true,encrypted_capture:true,authenticated_verify:true,wrong_key_rejected:true,source_restore_rejected:true,isolated_restore:true,counts_and_credit_totals_preserved:true,rls_isolation:true,unauthorized_wallet_write_rejected:true,nonempty_target_rejected:true,production_backup_verified:false}));
}finally{rmSync(folder,{recursive:true,force:true});}
