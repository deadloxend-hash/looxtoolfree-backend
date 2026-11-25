import {env,authenticate,account,authReady,rows,rpc,uuid,handler,method,json,need,limit} from '../lib/core.js';
import {looxKnowledge,toolMatches} from '../lib/loox-knowledge.js';
const toolAdvice=(query)=>{const hits=toolMatches(query);return hits.length?hits.map(t=>t.name+': '+t.url+'; '+t.note).join('\n'):'No exact named tool match. Do not invent a feature or page.';};
export const systemText=query=>`You are LOOX AI Assistant, a general-purpose AI assistant. Answer the user's actual question directly. Help with coding, writing, explanations, brainstorming and general knowledge. Follow the user's requested language, tone and detail level, and use the conversation context. Greet briefly when greeted. Do not repeatedly introduce yourself, repeat answers or insert website navigation into ordinary conversations. Offer website links only when asked or directly relevant. Use clear Markdown, fenced code blocks and descriptive link labels when helpful. Be honest about uncertainty, limitations and your third-party model integration. Do not claim to browse, execute code, analyze attachments or perform actions you cannot actually perform. Do not invent facts, sources, features or live service availability. ${/\b(?:loox|this (?:site|website)|your (?:site|website))\b/i.test(query)?'For questions specifically about LOOX, use this reference without assuming every feature is available: '+looxKnowledge+' Relevant directory entries: '+toolAdvice(query):''}`;
const friendly=(status)=>status===402?'LOOX AI chat is temporarily unavailable because the service needs processing balance. Please try again after activation.':status===429?'LOOX AI chat is busy. Please try again later.':'LOOX AI chat could not complete your response. Try again later.';
export default handler(async(req,res)=>{
 need(['GET','POST'].includes(req.method),405,'Unsupported method.');
 need(authReady(),503,'LOOX AI chat setup is pending.');
 const user=await authenticate(req);await account(user);
 const quota=async kind=>{const maximum=kind==='premium'?20:25;try{const data=await rows('limits',{key:'eq.chat:'+kind+':'+user.id,select:'used,expires_at',limit:'1'});const entry=data[0];const valid=entry&&Date.parse(entry.expires_at)>Date.now();return {remaining:Math.max(0,maximum-(valid?entry.used:0)),limit:maximum,resetAt:valid?entry.expires_at:null,model:kind};}catch{return {remaining:null,limit:maximum,resetAt:null,model:kind}}};
 if(req.method==='GET'){return res.json({free:await quota('free')});}
 const {message,history=[],model='free',threadId=null}=json(req);
 need(model==='free',400,'Choose a valid LOOX chat model.');
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

 // Exact LOOX tool availability questions use the verified directory rather than a model guess.
 try{await limit(user,'chat:free',25,86400);}catch(error){
  if(error.status!==429)throw error;
  const usage=await quota('free');
  return res.status(429).json({error:'AI Assistant is temporarily unavailable. Please try again later.',resetAt:usage.resetAt});
 }
 const availabilityQuestion=/\b(?:is there|do (?:you|we|loox) have|does (?:loox|this (?:site|website)) have|any .{0,50} tool|have a .{0,40}(?:tool|editor)|in (?:this|your|loox) (?:site|website))\b/i.test(message);
 const candidates=toolMatches(message);
 const strongest=candidates[0];
 if(/\b(?:loox|this (?:site|website)|your (?:site|website))\b/i.test(message)&&availabilityQuestion&&strongest&&strongest.score>=7){
  return respond('Yes. LOOX Tools has '+strongest.name+'\n\nOpen it here: '+strongest.url+'\n\n'+strongest.note+'\n\nYou can also browse all tools at https://deadloxend-hash.github.io/looxtoolsfree/index.html',model);
 }
 if(model==='free'){
  need(Boolean(env.GEMINI_API_KEY),503,'LOOX AI Free is awaiting service activation. Please try again later.');
  const contents=[...contextMessages.slice(-12).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.text}]})),{role:'user',parts:[{text:message.trim()}]}];
  let result;
  try{result=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:systemText(message)}]},contents,generationConfig:{maxOutputTokens:768,temperature:0.65}}),signal:AbortSignal.timeout(45000)});}catch{need(false,503,'LOOX AI Free is temporarily unavailable. Please try again.');}
  if(!result.ok){console.error('LOOX free chat rejected',{status:result.status,model:'gemini-3.5-flash-lite'});need(false,result.status===429?429:503,result.status===429?'LOOX AI Free is busy or its daily allowance is exhausted. Please try again later.':'LOOX AI Free is temporarily unavailable. Please try again later.');}
  const output=await result.json();const reply=(output.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim();
  need(reply,503,'LOOX AI could not generate a response. Please try another question.');
  return respond(reply,'free');
 }
});
