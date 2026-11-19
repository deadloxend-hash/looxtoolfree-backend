// A deliberately small, runnable workflow catalog using existing atomic job reservations.
// No additional wallet writes or unimplemented processing steps are exposed.
import {need,uuid} from './core.js';
import {start} from './jobs.js';
import {cloudVideoJob} from './video-cloud.js';
const definitions=[
 {id:'image-creation',title:'Idea to image',category:'AI Image Creation',kind:'image',prefix:'',steps:['Write a prompt','Generate image','Review and export']},
 {id:'product-photo',title:'Product spotlight',category:'Product Photography',kind:'image',prefix:'Professional product photography, clean studio composition, accurate material textures. ',steps:['Describe your product','Generate product image','Review and export']},
 {id:'social-content',title:'Social story',category:'Social Media Content',kind:'image',prefix:'Striking editorial social media image, clear focal point, cinematic lighting. ',steps:['Describe a story','Generate social image','Review and export']},
 {id:'cinematic-video',title:'Idea to motion',category:'AI Video Creation',kind:'video',prefix:'',steps:['Describe a shot','Generate video','Review and export']},
 {id:'animate-image',title:'Animate a still',category:'Image-to-Video',kind:'video',requiresImage:true,prefix:'',steps:['Upload a start frame','Generate motion','Review and export']}
];
export const workflowCatalog=()=>({items:definitions.map(d=>({...d,runnable:true})),unavailable:['Image Enhancement','Character Consistency','Creative Editing'],storage:'Saved starter preferences are stored on this device. Generated outputs remain in your private account.'});
export function createWorkflowRunner({image=start,video=cloudVideoJob}={}){
 return async(user,body)=>{
  const definition=definitions.find(d=>d.id===body.workflow);
  need(definition,400,'Choose a supported workflow.');
  need(uuid.test(body.requestId||''),400,'Invalid workflow request ID.');
  need(typeof body.prompt==='string'&&body.prompt.trim().length>0&&body.prompt.length<=700,400,'Describe your workflow in 1–700 characters.');
  need(!definition.requiresImage||typeof body.image==='string',400,'Upload a start frame for this workflow.');
  const prompt=definition.prefix+body.prompt.trim();
  const common={requestId:body.requestId,prompt,ratio:body.ratio,...(body.expectedCredits==null?{}:{expectedCredits:body.expectedCredits})};
  if(definition.kind==='image'){
   need(body.model==='flux',400,'This image workflow currently supports FLUX.1 Schnell.');
   return {workflow:definition.id,...await image(user,{...common,operation:'generate'})};
  }
  need(typeof body.model==='string'&&body.model!=='wan21',400,'Choose an available video model.');
  return {workflow:definition.id,...await video(user,{...common,model:body.model,duration:body.duration,quoteToken:body.quoteToken,...(body.image?{image:body.image}:{})})};
 };
}
export const runWorkflow=createWorkflowRunner();
