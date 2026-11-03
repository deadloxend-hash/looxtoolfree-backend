import {authenticate,authReady,env,json,limit,method,need,rows,supa,uuid} from './core.js';

// A verified Supabase Auth app_metadata flag, never browser or user_metadata.
const isAdmin=u=>u.app_metadata?.loox_template_admin===true;
async function signed(path){
 if(!path)return null;
 const data=await supa('/storage/v1/object/sign/loox-results/'+path,{
  method:'POST',body:JSON.stringify({expiresIn:900})
 });
 return data?.signedURL?env.SUPABASE_URL+'/storage/v1'+data.signedURL:null;
}
async function itemsWithImages(items){
 return Promise.all(items.map(async item=>{
  const [job]=await rows('jobs',{id:'eq.'+item.job_id,state:'eq.succeeded',operation:'eq.generate',select:'result_path'});
  if(!job?.result_path)return null;
  try{return {id:item.id,prompt:item.prompt,status:item.status,submitted_at:item.submitted_at,
   url:await signed(job.result_path)};}catch{return null;}
 })).then(items=>items.filter(x=>x?.url));
}
export async function templateAction(req,res,action){
 need(authReady(),503,'Templates are temporarily unavailable.');
 if(action==='public'){
  method(req,'GET');
  const offset=Number(req.query.offset||0);
  need(Number.isInteger(offset)&&offset>=0&&offset<=300,400,'Invalid page.');
  const records=await rows('template_submissions',{status:'eq.approved',select:'id,job_id,prompt,status,submitted_at',
   order:'reviewed_at.desc',limit:'12',offset:String(offset)});
  return res.json({items:await itemsWithImages(records),has_more:records.length===12});
 }
 const user=await authenticate(req);
 if(action==='submit'){
  method(req,'POST');await limit(user,'template_submit',5,3600);
  const body=json(req);
  need(uuid.test(body.job_id),400,'Invalid image.');
  need(body.consent===true,400,'Confirm that you want to submit your image and prompt for public review.');
  const [job]=await rows('jobs',{id:'eq.'+body.job_id,user_id:'eq.'+user.id,
   operation:'eq.generate',state:'eq.succeeded',result_path:'not.is.null',
   select:'id,prompt,result_path'});
  need(job&&job.prompt&&job.result_path?.startsWith(user.id+'/'),404,'Completed image not found.');
  const previous=await rows('template_submissions',{job_id:'eq.'+job.id,select:'id,status'});
  need(!previous.length,409,'This image has already been submitted.');
  const result=await supa('/rest/v1/loox_template_submissions',{
   method:'POST',headers:{Prefer:'return=representation'},
   body:JSON.stringify({user_id:user.id,job_id:job.id,prompt:job.prompt,status:'pending'})
  });
  return res.status(201).json({id:result[0].id,status:'pending'});
 }
 if(action==='mine'){
  method(req,'GET');
  const items=await rows('template_submissions',{user_id:'eq.'+user.id,
   select:'id,job_id,status,submitted_at',order:'submitted_at.desc',limit:'100'});
  return res.json({items});
 }
 need(isAdmin(user),403,'Administrator access required.');
 if(action==='queue'){
  method(req,'GET');
  const records=await rows('template_submissions',{status:'eq.pending',
   select:'id,job_id,prompt,status,submitted_at',order:'submitted_at.asc',limit:'50'});
  return res.json({items:await itemsWithImages(records)});
 }
 if(action==='review'){
  method(req,'POST');await limit(user,'template_review',40,60);
  const body=json(req);
  need(uuid.test(body.id)&&['approved','rejected'].includes(body.status),400,'Invalid review.');
  const [item]=await rows('template_submissions',{id:'eq.'+body.id,status:'eq.pending',
   select:'id,job_id,user_id'});
  need(item,409,'Submission is no longer pending.');
  const [job]=await rows('jobs',{id:'eq.'+item.job_id,user_id:'eq.'+item.user_id,
   state:'eq.succeeded',result_path:'not.is.null',select:'result_path'});
  need(job?.result_path?.startsWith(item.user_id+'/'),409,'Source image no longer exists.');
  const changed=await supa('/rest/v1/loox_template_submissions?'+new URLSearchParams({id:'eq.'+item.id,status:'eq.pending'}),{
   method:'PATCH',headers:{Prefer:'return=representation'},
   body:JSON.stringify({status:body.status,reviewed_at:new Date().toISOString(),reviewed_by:user.id})
  });
  need(changed.length===1,409,'Submission already reviewed.');
  return res.json({id:item.id,status:body.status});
 }
 need(false,404,'Unknown templates action.');
}
