import {createHash} from 'node:crypto';
export function databaseTarget(value){
 let target;try{target=new URL(value);}catch{throw Error('Configure the database URL privately in the runner.');}
 let name;try{name=decodeURIComponent(target.pathname.slice(1));}catch{throw Error('Invalid database target.');}
 if(!['postgres:','postgresql:'].includes(target.protocol)||!target.hostname||!/[A-Za-z0-9_]/.test(name)||!(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/).test(name))throw Error('Invalid database target.');
 return target;
}
export function projectReference(target){
 // A direct db.<ref>.supabase.co connection and postgres.<ref> pooler user
 // identify the same project even if their hosts, ports or databases differ.
 const host=target.hostname.toLowerCase().replace(/\.$/,'');
 const direct=/^(?:db\.)?([a-z0-9]{20})\.supabase\.co$/.exec(host)?.[1]||null;
 const pooled=/^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(target.username))?.[1]||null;
 if(direct&&pooled&&direct!==pooled)throw Error('Database connection identifies conflicting projects.');
 return direct||pooled;
}
export const databaseFingerprint=target=>createHash('sha256').update(target.hostname.toLowerCase().replace(/\.$/,'')+':'+(target.port||'5432')+target.pathname).digest('hex');
export function assertIsolatedTarget(metadata,target,sourceURL){
 if(!metadata.source_project&&!sourceURL)throw Error('Configure the original source database privately before restoring an older or unidentified backup.');
 const ref=projectReference(target),source=sourceURL?databaseTarget(sourceURL):null;
 if(databaseFingerprint(target)===metadata.source_fingerprint||metadata.source_project&&ref===metadata.source_project||source&&(databaseFingerprint(target)===databaseFingerprint(source)||ref&&ref===projectReference(source)))throw Error('Refusing to restore into the source database.');
}
