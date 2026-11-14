import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const history=process.argv.includes('--history');
const patterns=[['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['provider secret',/\b(?:sk_live|sk_test|sb_secret)_[a-zA-Z0-9]{20,}/],['OpenAI secret',/\bsk-(?:proj-|svcacct-)[a-zA-Z0-9_-]{30,}/],['Google API key',/\bAIza[a-zA-Z0-9_-]{35}\b/],['GitHub token',/\b(?:ghp_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,})/],['AWS key',/\bAKIA[0-9A-Z]{16}\b/]];
const textPath=path=>/\.(?:js|mjs|ts|tsx|json|py|sql|md|html|ya?ml|example)$/.test(path)||/(^|\/)\.env(?:\.|$)/.test(path);
let issues=0,checked=0;
function scan(source,path,sha='working tree'){
 const found=patterns.filter(([,pattern])=>pattern.test(source)).map(([name])=>name);
 for(const token of source.matchAll(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g))try{if(JSON.parse(Buffer.from(token[0].split('.')[1],'base64url')).role==='service_role'){found.push('Supabase service-role JWT');break;}}catch{}
 for(const category of new Set(found)){console.error(path+' @ '+sha+': suspected '+category+' (value withheld)');issues++;}
 checked++;
}
if(!history){for(const path of execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))if(textPath(path))scan(readFileSync(path,'utf8'),path);}
else{
 const objects=new Map();for(const line of execFileSync('git',['rev-list','--objects','--all'],{encoding:'utf8',maxBuffer:32*1024*1024}).split('\n')){const at=line.indexOf(' ');if(at>0&&textPath(line.slice(at+1)))objects.set(line.slice(0,at),line.slice(at+1));}
 const hashes=[...objects.keys()];
 const output=execFileSync('git',['cat-file','--batch'],{input:hashes.join('\n')+'\n',maxBuffer:256*1024*1024});let at=0;
 while(at<output.length){const end=output.indexOf(10,at);if(end<0)break;const [sha,type,size]=output.subarray(at,end).toString().split(' ');const count=Number(size);if(!Number.isSafeInteger(count))throw Error('Invalid Git object response.');at=end+1;if(type==='blob')scan(output.subarray(at,at+count).toString('utf8'),objects.get(sha),sha);at+=count+1;}
}
console.log('Secret-pattern scan: '+checked+' '+(history?'historical blobs':'tracked text files')+' checked; '+issues+' finding(s). Values are never printed.');process.exitCode=issues?1:0;
