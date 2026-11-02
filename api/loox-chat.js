import {env,authenticate,account,authReady,rows,handler,method,json,need,limit} from '../lib/core.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const friendly=(status)=>status===402?'LOOX AI chat is temporarily unavailable because the service needs processing balance. Please try again after activation.':status===429?'LOOX AI chat is busy. Please try again later.':'LOOX AI chat could not complete your response. Try again later.';
export default handler(async(req,res)=>{
 method(req,'POST');
 need(authReady(),503,'LOOX AI chat setup is pending.');
 const user=await authenticate(req);await account(user);
 const {message,history=[],model='free'}=json(req);
 need(['free','premium'].includes(model),400,'Choose a valid LOOX chat model.');
 need(typeof message==='string'&&message.trim().length>=1&&message.length<=1800,400,'Enter a message up to 1,800 characters.');
 need(Array.isArray(history)&&history.length<=12&&history.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string'&&m.text.length<=1600),400,'Invalid conversation.');
 if(model==='premium'){
  const subscriptions=await rows('subscriptions',{select:'plan,status,ends_at',user_id:'eq.'+user.id,limit:'20'});
  const active=subscriptions.some(s=>['pro','lifetime'].includes(s.plan)&&['active','trialing'].includes(s.status)&&(!s.ends_at||Date.parse(s.ends_at)>Date.now()));
  need(active,403,'LOOX AI Pro requires an active paid subscription. Upgrade your account to unlock it.');
 }
 await limit(user,'chat:'+model,model==='premium'?20:8,86400);
 if(model==='free'){
  need(Boolean(env.GEMINI_API_KEY),503,'LOOX AI Free is awaiting service activation. Please try again later.');
  const contents=[...history.slice(-8).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.text}]})),{role:'user',parts:[{text:message.trim()}]}];
  let result;
  try{result=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:'You are LOOX AI Assistant, a helpful AI assistant integrated into LOOX Tools. LOOX develops the user interface, not the underlying foundation model. If asked about the underlying model or provider, answer truthfully. Never claim to have completed external actions. Be helpful, accurate and concise.'}]},contents,generationConfig:{maxOutputTokens:768,temperature:0.65}}),signal:AbortSignal.timeout(45000)});}catch{need(false,503,'LOOX AI Free is temporarily unavailable. Please try again.');}
  if(!result.ok){console.error('LOOX free chat rejected',{status:result.status});need(false,result.status===429?429:503,result.status===429?'LOOX AI Free is busy or its daily allowance is exhausted. Please try again later.':'LOOX AI Free is temporarily unavailable. Please try again later.');}
  const output=await result.json();const reply=(output.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim();
  need(reply,503,'LOOX AI could not generate a response. Please try another question.');
  return res.json({reply:reply.slice(0,6000),model:'free'});
 }
 need(Boolean(env.REPLICATE_API_TOKEN),503,'LOOX AI Pro is awaiting service activation.');
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
 res.json({reply:response.slice(0,6000),model:'premium'});
});