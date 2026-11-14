import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
const MAGIC=Buffer.from('LOOXBACKUP1');
export function backupKey(value){const key=Buffer.from(value||'','base64');if(key.length!==32||key.toString('base64')!==value)throw Error('Set a canonical base64-encoded 32-byte LOOX_BACKUP_KEY in the runner secret store.');return key;}
export function sealBackup(bytes,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([MAGIC,iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);}
export function openBackup(bytes,key){if(bytes.length<39||!bytes.subarray(0,MAGIC.length).equals(MAGIC))throw Error('Invalid LOOX backup.');const start=MAGIC.length,decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(start,start+12));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(start+12,-16)),decipher.final()]);}
