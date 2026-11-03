import {env,authenticate,account,authReady,rows,rpc,uuid,handler,method,json,need,limit} from '../lib/core.js';
import {looxKnowledge,directory,toolMatches} from '../lib/loox-knowledge.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const catalog=directory.map(t=>t.name+' ('+t.slug+'.html)').join(', ');
const toolAdvice=(query)=>{const hits=toolMatches(query);return hits.length?hits.map(t=>t.name+': '+t.url+'; '+t.note).join('\n'):'No exact named tool match. Do not invent a feature or page.';};
const systemText=query=>`You are LOOX AI Assistant, the official helpful guide for LOOX Tools. ${looxKnowledge}\nDIRECTORY OF REAL LOOX PAGES: ${catalog}\nRELEVANT TOOL LINKS: ${toolAdvice(query)}\nRules: When a visitor asks if LOOX has a feature, look in this directory; if it exists, say YES and give the exact LOOX URL (even if the chat page itself cannot edit media). For Face Blur, link https://deadloxend-hash.github.io/looxtoolsfree/face-blur.html ; it supports automatic and manual face blur. Offer short, helpful directions to use LOOX tools. Prioritize LOOX links rather than advertising unrelated competing platforms when LOOX offers a suitable tool. If the user explicitly requests external alternatives or LOOX has no relevant option, be objective and honest. Do not make up links, claim tools are working or free when their live status is unknown, or fabricate features. If the user asks unrelated general questions, answer them normally. If someone asks who made you, say LOOX integrated this assistant using a third-party AI model; answer provider questions truthfully. Keep answers concise and accurate.`;
const friendly=(status)=>status===402?'LOOX AI chat is temporarily unavailable because the service needs processing balance. Please try again after activation.':status===429?'LOOX AI chat is busy. Please try again later.':'LOOX AI chat could not complete your response. Try again later.';
export default handler(async(req,res)=>{
 need(['GET','POST'].includes(req.method),405,'Unsupported method.');
 need(authReady(),503,'LOOX AI chat setup is pending.');
 const user=await authenticate(req);await account(user);
 const quota=async kind=>{const maximum=kind==='premium'?20:25;try{const data=await rows('limits',{key:'eq.chat:'+kind+':'+user.id,select:'used,expires_at',limit:'1'});const entry=data[0];const valid=entry&&Date.parse(entry.expires_at)>Date.now();return {remaining:Math.max(0,maximum-(valid?entry.used:0)),limit:maximum,resetAt:valid?entry.expires_at:null,model:kind};}catch{return {remaining:null,limit:maximum,resetAt:null,model:kind}}};
 if(req.method==='GET'){return res.json({free:await quota('free'),premium:await quota('premium')});}
 const {message,history=[],model='free',threadId=null}=json(req);
 need(['free','premium'].includes(model),400,'Choose a valid LOOX chat model.');
 need(typeof message==='string'&&message.trim().length>=1&&message.length<=1800,400,'Enter a message up to 1,800 characters.');
 need(Array.isArray(history)&&history.length<=12&&history.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string'&&m.text.length<=1600),400,'Invalid conversation.');
 // An authenticated account's own saved thread is the authoritative context.
 let contextMessages=history;
 let ownedThread=null;
 if(threadId!==null){
  need(typeof threadId==='string'&&uuid.test(threadId),400,'Invalid chat ID.');
  [ownedThread]=await rows('chat_threads',{id:'eq.'+threadId,user_id:'eq.'+user.id,
   select:'id,title,model',limit:'1'});
  need(ownedThread&&ownedThread.model===model,403,'Chat does not belong to this model or account.');
  const prev=await rows('chat_messages',{thread_id:'eq.'+threadId,
   select:'role,content',order:'id.desc',limit:'12'});
  contextMessages=prev.reverse().map(m=>({role:m.role,text:m.content}));
 }
 // Commit the first chat and each later question/answer together, AFTER
 // the model has produced a valid reply. Failed or credit-blocked requests
 // never create threads or alter saved conversations.
 const respond=async(reply,selected)=>{
  const text=String(reply||'').trim().slice(0,6000);
  need(text,503,'LOOX AI returned an empty response.');
  const savedId=await rpc('chat_commit',{
   p_user:user.id,p_thread:ownedThread?.id||null,p_model:selected,
   p_question:message.trim(),p_answer:text
  });
  need(typeof savedId==='string'&&uuid.test(savedId),503,'Could not save your reply.');
  return res.json({reply:text,model:selected,threadId:savedId,usage:await quota(selected)});
 };
 if(model==='premium'){
  const subscriptions=await rows('subscriptions',{select:'plan,status,ends_at',user_id:'eq.'+user.id,limit:'20'});
  const active=subscriptions.some(s=>['pro','lifetime'].includes(s.plan)&&['active','trialing'].includes(s.status)&&(!s.ends_at||Date.parse(s.ends_at)>Date.now()));
  need(active,403,'LOOX AI Pro requires an active paid subscription. Upgrade your account to unlock it.');
 }

 // Exact LOOX tool availability questions use the verified directory rather than a model guess.
 await limit(user,'chat:'+model,model==='premium'?20:25,86400);
 const availabilityQuestion=/\b(?:is there|do (?:you|we|loox) have|does (?:loox|this (?:site|website)) have|any .{0,50} tool|have a .{0,40}(?:tool|editor)|in (?:this|your|loox) (?:site|website))\b/i.test(message);
 const candidates=toolMatches(message);
 const strongest=candidates[0];
 if(availabilityQuestion&&strongest&&strongest.score>=7){
  return respond('Yes. LOOX Tools has '+strongest.name+'\n\nOpen it here: '+strongest.url+'\n\n'+strongest.note+'\n\nYou can also browse all tools at https://deadloxend-hash.github.io/looxtoolsfree/index.html',model);
 }
 if(model==='free'){
  need(Boolean(env.GEMINI_API_KEY),503,'LOOX AI Free is awaiting service activation. Please try again later.');
  const contents=[...contextMessages.slice(-8).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.text}]})),{role:'user',parts:[{text:message.trim()}]}];
  let result;
  try{result=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:systemText(message)}]},contents,generationConfig:{maxOutputTokens:768,temperature:0.65}}),signal:AbortSignal.timeout(45000)});}catch{need(false,503,'LOOX AI Free is temporarily unavailable. Please try again.');}
  if(!result.ok){console.error('LOOX free chat rejected',{status:result.status,model:'gemini-3.5-flash-lite'});need(false,result.status===429?429:503,result.status===429?'LOOX AI Free is busy or its daily allowance is exhausted. Please try again later.':'LOOX AI Free is temporarily unavailable. Please try again later.');}
  const output=await result.json();const reply=(output.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim();
  need(reply,503,'LOOX AI could not generate a response. Please try another question.');
  return respond(reply,'free');
 }
 need(Boolean(env.REPLICATE_API_TOKEN),503,'LOOX AI Pro is awaiting service activation.');
 const context=contextMessages.slice(-8).map(m=>(m.role==='user'?'User':'Assistant')+': '+m.text).join('\n');
 const prompt=(context?context+'\n':'')+'User: '+message.trim()+'\nAssistant:';
 const headers={'Authorization':'Bearer '+env.REPLICATE_API_TOKEN,'Content-Type':'application/json','Prefer':'wait=25'};
 const origin='https://api.replicate.com/v1/';
 let r;
 try{r=await fetch(origin+'models/meta/meta-llama-3-8b-instruct/predictions',{method:'POST',headers,body:JSON.stringify({input:{prompt,system_prompt:systemText(message),max_tokens:350,temperature:0.6}}),signal:AbortSignal.timeout(35000)});}catch{need(false,503,'LOOX AI chat is temporarily unavailable.');}
 if(!r.ok){console.error('LOOX chat model submission rejected',{status:r.status});need(false,r.status===429?429:503,friendly(r.status));}
 let prediction=await r.json();for(let i=0;i<9&&['starting','processing'].includes(prediction.status);i++){
 await sleep(1500);const t=await fetch(origin+'predictions/'+encodeURIComponent(prediction.id),{headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN},signal:AbortSignal.timeout(12000)});if(!t.ok)break;prediction=await t.json();
 }
 if(prediction.status!=='succeeded'){console.error('LOOX chat not completed',{status:prediction.status});need(false,503,'LOOX AI chat could not complete your response. Try again later.');}
 const response=Array.isArray(prediction.output)?prediction.output.join(''):String(prediction.output||'');
 need(response.trim().length>0,503,'LOOX AI chat returned no response.');
 return respond(response,'premium');
});