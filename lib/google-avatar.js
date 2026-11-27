import {profileImageDimensions} from '../cloudflare/loox-profile-api.js';
import {need} from './core.js';
const hosts=new Set(['lh3.googleusercontent.com','lh4.googleusercontent.com','lh5.googleusercontent.com','lh6.googleusercontent.com']);
export async function googleAvatar(user,{request=fetch}={}){
 const identity=user.identities?.find(i=>i.provider==='google');
 let url;try{url=new URL(identity?.identity_data?.picture||identity?.identity_data?.avatar_url);}catch{}
 need(url&&url.protocol==='https:'&&hosts.has(url.hostname)&&!url.username&&!url.password&&!url.port&&/^\/a(?:\/|-\/)/.test(url.pathname),404,'No Google profile picture is available.');
 const r=await request(url.href,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(8000)});
 need(r.ok,404,'Profile picture is unavailable.');const mime=(r.headers.get('content-type')||'').split(';')[0].toLowerCase();
 need(['image/png','image/jpeg','image/webp'].includes(mime),415,'Profile picture format is unavailable.');
 const reader=r.body?.getReader();need(reader,503,'Profile picture is unavailable.');let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;need(size<=524288,413,'Profile picture exceeds the size limit.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=Buffer.concat(chunks.map(b=>Buffer.from(b)));const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 need(valid,415,'Profile picture format is unavailable.');const dimensions=profileImageDimensions(bytes,mime);need(dimensions.width<=2048&&dimensions.height<=2048,415,'Profile picture dimensions exceed the limit.');return {bytes,mime};
}
