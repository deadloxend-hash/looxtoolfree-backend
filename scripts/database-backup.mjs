// Offline/isolated recovery utility. No production restore operation exists here.
import {spawnSync} from 'node:child_process';
import {writeFileSync,readFileSync,mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {backupKey,sealBackup,openBackup} from '../src/recovery/encrypted-backup.js';
const [action,file]=process.argv.slice(2);
if(!['capture','verify','restore-isolated'].includes(action)||!file){console.error('Usage: node scripts/database-backup.mjs capture|verify|restore-isolated <absolute .looxbackup path>. Capture requires SUPABASE_DB_URL and LOOX_BACKUP_KEY. Restore requires a DIFFERENT isolated LOOX_RESTORE_DB_URL and LOOX_RESTORE_ISOLATED=true.');process.exit(2);}
const path=resolve(file),key=backupKey(process.env.LOOX_BACKUP_KEY);
const dbConfig=value=>{let u;try{u=new URL(value);}catch{throw Error('Configure the database URL privately in the runner.');}if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname||!u.pathname.slice(1))throw Error('Invalid database target.');return u;};
const projectReference=u=>/^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname)?.[1]||/^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username))?.[1]||null;
const fingerprint=u=>createHash('sha256').update(u.hostname.toLowerCase()+':'+(u.port||'5432')+u.pathname).digest('hex');
const pgEnv=u=>({...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGSSLMODE:process.env.LOOX_BACKUP_SSLMODE||'verify-full'});
const run=(name,args,env)=>{const r=spawnSync(name,args,{env,encoding:null,maxBuffer:256*1024*1024,stdio:['ignore','pipe','pipe']});if(r.error||r.status!==0)throw Error(name+' failed. Inspect private runner diagnostics; credentials and raw stderr are intentionally withheld.');return r.stdout;};
if(action==='capture'){
 const source=dbConfig(process.env.SUPABASE_DB_URL);
 // pg_dump holds a transactionally consistent PostgreSQL snapshot. No plaintext file is written.
 const dump=run('pg_dump',['--format=custom','--no-owner'],pgEnv(source));
 const metadata={created_at:new Date().toISOString(),source_fingerprint:fingerprint(source),source_project:projectReference(source)};
 const encrypted=sealBackup(Buffer.concat([Buffer.from(JSON.stringify(metadata)+'\n'),dump]),key);writeFileSync(path,encrypted,{mode:0o600,flag:'wx'});chmodSync(path,0o600);
 const manifest={format:1,created_at:new Date().toISOString(),source_fingerprint:metadata.source_fingerprint,bytes:encrypted.length,sha256:createHash('sha256').update(encrypted).digest('hex')};
 writeFileSync(path+'.manifest.json',JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({saved:true,bytes:encrypted.length,encrypted:true,restore_tested:false}));
}else{
 const encrypted=readFileSync(path),manifest=JSON.parse(readFileSync(path+'.manifest.json'));
 if(manifest.format!==1||manifest.bytes!==encrypted.length||manifest.sha256!==createHash('sha256').update(encrypted).digest('hex'))throw Error('Backup checksum mismatch.');
 const authenticated=openBackup(encrypted,key);const boundary=authenticated.indexOf(10);if(boundary<0||boundary>4096)throw Error('Invalid encrypted backup metadata.');
 const metadata=JSON.parse(authenticated.subarray(0,boundary).toString('utf8')),plain=authenticated.subarray(boundary+1);
 if(metadata.source_fingerprint!==manifest.source_fingerprint)throw Error('Backup source metadata mismatch.'); // Authentication MUST finish before pg_restore is invoked.
 if(action==='verify'){console.log(JSON.stringify({authenticated:true,bytes:plain.length,restore_tested:false}));}
 else{
  if(process.env.LOOX_RESTORE_ISOLATED!=='true')throw Error('Restore is limited to an explicitly marked isolated target.');
  const target=dbConfig(process.env.LOOX_RESTORE_DB_URL);
  if(fingerprint(target)===metadata.source_fingerprint||metadata.source_project&&projectReference(target)===metadata.source_project||process.env.SUPABASE_DB_URL&&fingerprint(target)===fingerprint(dbConfig(process.env.SUPABASE_DB_URL)))throw Error('Refusing to restore into the source database.');
  const existing=run('psql',['--no-psqlrc','--tuples-only','--no-align','--command',"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')"],pgEnv(target)).toString().trim();
  if(existing!=='0')throw Error('Restore requires an empty public schema in an isolated database.');
  const folder=mkdtempSync(join(tmpdir(),'loox-restore-'));chmodSync(folder,0o700);
  try{const dump=join(folder,'backup.dump');writeFileSync(dump,plain,{mode:0o600});
   run('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--dbname',decodeURIComponent(target.pathname.slice(1)),dump],pgEnv(target));
   console.log(JSON.stringify({restored:true,isolated:true,validation_required:'Verify row counts, balances, grants, RLS and media references before declaring recovery complete.'}));
  }finally{rmSync(folder,{recursive:true,force:true});}
 }
}
