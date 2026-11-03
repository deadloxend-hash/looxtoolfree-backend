import {authenticate,account,authReady,handler,method,json,need,limit,rows,supa,uuid} from '../lib/core.js';

// All requests are authenticated against Supabase. Service-only storage is
// always filtered by the verified account's user_id.
export default handler(async(req,res)=>{
 need(authReady(),503,'Chat history is unavailable.');
 need(['GET','POST'].includes(req.method),405,'Method not allowed.');
 const u=await authenticate(req);await account(u);
 await limit(u,'chat-history',120,60);
 const action=String(req.query.action||'list');
 if(req.method==='GET'){
  if(action==='list'){
   const offset=Number(req.query.offset||0);
   need(Number.isInteger(offset)&&offset>=0&&offset<=1000,400,'Invalid history page.');
   const threads=await rows('chat_threads',{
    user_id:'eq.'+u.id,select:'id,title,model,created_at,updated_at',
    order:'updated_at.desc',limit:'40',offset:String(offset)
   });
   return res.json({threads,has_more:threads.length===40});
  }
  if(action==='read'){
   const id=req.query.id;
   need(typeof id==='string'&&uuid.test(id),400,'Invalid chat ID.');
   const [thread]=await rows('chat_threads',{id:'eq.'+id,user_id:'eq.'+u.id,
    select:'id,title,model,created_at,updated_at',limit:'1'});
   need(thread,404,'Chat not found.');
   const messages=await rows('chat_messages',{
    thread_id:'eq.'+id,select:'id,role,content,created_at',order:'id.desc',limit:'200'
   });
   return res.json({thread,messages:messages.reverse()});
  }
  need(false,404,'Unknown history action.');
 }
 method(req,'POST');
 const b=json(req);
 // Creating empty threads is disabled: chats are now created only when
 // the assistant has successfully replied and the server commits both turns.
 if(action==='create')need(false,410,'Empty conversations cannot be saved.');
 if(action==='delete'){
  need(typeof b.id==='string'&&uuid.test(b.id),400,'Invalid chat ID.');
  await limit(u,'delete-chat',30,60);
  await supa('/rest/v1/loox_chat_threads?'+new URLSearchParams({id:'eq.'+b.id,user_id:'eq.'+u.id}),{
   method:'DELETE'
  });
  return res.json({deleted:true});
 }
 need(false,404,'Unknown history action.');
});
