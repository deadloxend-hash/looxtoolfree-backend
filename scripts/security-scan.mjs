import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const paths=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const patterns=[['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['provider secret',/\b(?:sk_live|sk_test|sb_secret)_[a-zA-Z0-9]{20,}/],['GitHub token',/\b(?:ghp_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,})/],['AWS key',/\bAKIA[0-9A-Z]{16}\b/]];
let issues=0;for(const path of paths){if(!/\.(?:js|mjs|json|py|sql|md|html|yml|example)$/.test(path))continue;const source=readFileSync(path,'utf8');for(const [category,p]of patterns)if(p.test(source)){console.error(path+': suspected '+category+' (value withheld)');issues++;}}
console.log('Secret-pattern scan: '+paths.length+' tracked files checked; '+issues+' finding(s).');process.exitCode=issues?1:0;
