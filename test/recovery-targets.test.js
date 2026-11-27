import test from 'node:test';import assert from 'node:assert/strict';
import {databaseTarget,projectReference,databaseFingerprint,assertIsolatedTarget} from '../src/recovery/database-targets.js';
const A='abcdefghijklmnopqrst',B='zyxwvutsrqponmlkjihg';
const direct=ref=>'postgresql://postgres:fixture@db.'+ref+'.supabase.co:5432/postgres';
const pool=ref=>'postgresql://postgres.'+ref+':fixture@aws-0-region.pooler.supabase.com:6543/postgres';
test('restore guard recognizes direct, normalized and pooler aliases of the production project',()=>{
 const source=databaseTarget(direct(A)),metadata={source_fingerprint:databaseFingerprint(source),source_project:projectReference(source)};
 assert.equal(metadata.source_project,A);
 for(const url of [direct(A),pool(A),'postgresql://postgres:fixture@DB.'+A+'.SUPABASE.CO.:5432/postgres','postgresql://postgres.'+A+':fixture@another.pooler.supabase.com:5432/otherdb'])assert.throws(()=>assertIsolatedTarget(metadata,databaseTarget(url)),/source database/);
 assert.doesNotThrow(()=>assertIsolatedTarget(metadata,databaseTarget(pool(B))));
});
test('legacy backups without project metadata still reject source aliases when private source configuration exists',()=>{
 const source=databaseTarget(direct(A)),legacy={source_fingerprint:databaseFingerprint(source),source_project:null};
 assert.throws(()=>assertIsolatedTarget(legacy,databaseTarget(pool(B))),/original source/);
 assert.throws(()=>assertIsolatedTarget(legacy,databaseTarget(pool(A)),direct(A)),/source database/);
 assert.throws(()=>assertIsolatedTarget({source_fingerprint:databaseFingerprint(databaseTarget(pool(A)))},databaseTarget(direct(A)),pool(A)),/source database/);
});
test('invalid or conflicting database identity is rejected without leaking connection credentials',()=>{
 assert.throws(()=>databaseTarget('https://example.invalid/database'),/Invalid database/);
 assert.throws(()=>databaseTarget('not a database'),/privately/);
 assert.throws(()=>databaseTarget('postgresql://postgres:fixture@isolated.invalid/postgres%20host%3Dproduction.invalid'),/Invalid database/);
 assert.throws(()=>databaseTarget('postgresql://postgres:fixture@isolated.invalid/postgres%2Fother'),/Invalid database/);
 assert.throws(()=>projectReference(databaseTarget('postgresql://postgres.'+B+':fixture@db.'+A+'.supabase.co/postgres')),/conflicting/);
});
