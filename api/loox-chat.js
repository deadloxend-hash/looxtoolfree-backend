import {env,authenticate,account,authReady,handler,method,json,need,limit} from '../lib/core.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const friendly=(status)=>status===402?'LOOX AI chat is temporarily unavailable because the service needs processing balance. Please try again after activation.':status===429?'LOOX AI chat is busy. Please try again later.':'LOOX AI chat could not complete your response. Try again later.';
export default handler(async(req,res)=>{
 method(req,'POST');
 need(authReady()&&env.REPLICATE_API_TOKEN,503,'LOOX AI chat setup is pending.');
 const user=await authenticate(req);await account(user);
 const {message,history=[]}=json(req);
 need(typeof message==='string'&&message.trim().length>=1&&message.length<=1800,400,'Enter a message up to 1,800 characters.');
 need(Array.isArray(history)&&history.length<=12&&history.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string'&&m.text.length<=1600),400,'Invalid conversation.');
 await limit(user,'chat',8,86400);
 const context=history.slice(-8).map(m=>(m.role==='user'?'User':'Assistant')+': '+m.text).join('\n');
 const prompt=(context?context+'\n':'')+'User: '+message.trim()+'\nAssistant:';
 const headers={'Authorization':'Bearer '+env.REPLICATE_API_TOKEN,'Content-Type':'application/json','Prefer':'wait=25'};
 const origin='https://api.replicate.com/v1/';
 let r;
 try{r=await fetch(origin+'models/meta/meta-llama-3-8b-instruct/predictions',{method:'POST',headers,body:JSON.stringify({input:{prompt,system_prompt:'You are LOOX AI Assistant, a helpful, concise assistant. Clearly state uncertainty. Do not pretend to execute external actions.',max_tokens:350,temperature:0.6}}),signal:AbortSignal.timeout(35000)});}catch{need(false,503,'LOOX AI chat is temporarily unavailable.');}
 if(!r.ok){console.error('LOOX chat model submission rejected',{status:r.status});need(false,r.status===429?429:503,friendly(r.status));}
 let prediction=await r.json();for(let i=0;i<9&&['starting','processing'].includes(prediction.status);i++){
 await sleep(1500);const t=await fetch(origin+'predictions/'+encodeURIComponent(prediction.id),{headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN},signal:AbortSignal.timeout(12000)});if(!t.ok)break;prediction=await t.json();
 }
 if(prediction.status!=='succeeded'){console.error('LOOX chat not completed',{status:prediction.status});need(false,503,'LOOX AI chat could not complete your response. Try again later.');}
 const response=Array.isArray(prediction.output)?prediction.output.join(''):String(prediction.output||'');
 need(response.trim().length>0,503,'LOOX AI chat returned no response.');
 res.json({reply:response.slice(0,6000)});
});