/* Validated AI bridge. Credentials stay on the server; unavailable tasks fail explicitly. */
export const maxDuration=60;
const allowedTasks=['inpaint','outpaint','upscale','restore','retouch'];
function image(data,label){const m=typeof data==='string'&&data.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);if(!m)throw Error(label+' must be a PNG, JPEG or WebP data URL.');const bytes=Buffer.from(m[2],'base64');if(!bytes.length||bytes.length>2300000)throw Error(label+' exceeds the 2.2 MB upload limit.');return{mime:m[1],bytes,extension:m[1]==='image/jpeg'?'jpg':m[1].split('/')[1]}}
function cors(req,res){const origin=req.headers.origin,allowed=(process.env.MEDIA_AI_ORIGINS||'https://deadloxend-hash.github.io').split(',').map(s=>s.trim());if(origin&&!allowed.includes(origin)){res.status(403).json({error:'This website is not allowed to use this endpoint.'});return false}if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Cache-Control','no-store');return true}
export default async function handler(req,res){
 if(!cors(req,res))return;if(req.method==='OPTIONS')return res.status(204).end();
 const customURL=process.env.MEDIA_AI_URL,customKey=process.env.MEDIA_AI_KEY;
 const enabled=(process.env.MEDIA_AI_TASKS||'').split(',').map(s=>s.trim()).filter(t=>allowedTasks.includes(t));
 const tasks=customURL&&customKey?enabled:[];
 if(req.method==='GET')return res.status(200).json({tasks,providers:Object.fromEntries(tasks.map(task=>[task,'configured model'])),uploadLimit:2300000});
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
 try{
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};if(!tasks.includes(b.task))return res.status(503).json({error:'This AI operation has not been configured by the site owner.'});const source=image(b.image,'Source image');if(b.mask)image(b.mask,'Mask');if(['inpaint'].includes(b.task)&&!b.mask)throw Error('This task requires a painted mask.');
  const payload={task:b.task,image:b.image,prompt:typeof b.prompt==='string'?b.prompt.slice(0,1500):'',factor:[2,4].includes(Number(b.factor))?Number(b.factor):2,expandX:Math.max(1,Math.min(100,Number(b.expandX)||25)),expandY:Math.max(1,Math.min(100,Number(b.expandY)||25)),...(b.mask?{mask:b.mask}:{})};
  if(customURL&&customKey&&enabled.includes(b.task)){
   const url=new URL(customURL);if(url.protocol!=='https:')throw Error('The model service must use HTTPS.');const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+customKey,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(55000),redirect:'error'});
   if(!response.ok)return res.status(502).json({error:'The configured model service rejected the operation. Check its account, limits and task configuration.'});const type=(response.headers.get('content-type')||'').split(';')[0];if(!['image/png','image/jpeg','image/webp'].includes(type))return res.status(502).json({error:'The configured model must return PNG, JPEG or WebP bytes.'});const bytes=await response.arrayBuffer();if(bytes.byteLength>30*1048576)throw Error('The model output exceeds the download limit.');res.setHeader('Content-Type',type);return res.status(200).send(Buffer.from(bytes));
  }
  return res.status(503).json({error:'No configured AI processing service is available.'});
 }catch(e){return res.status(e instanceof SyntaxError?400:400).json({error:e.name==='TimeoutError'?'The model service timed out. Try a smaller image.':e.message||'Unable to process this image.'})}
}
