import {launch} from '../config/launch.js';
import sharp from 'sharp';
import {env,need,Problem,rows,rpc,supa,mac,uuid} from '../../lib/core.js';
import {saveGeneratedMedia,mediaURL,workerInputURL,userKey} from '../../lib/media-store.js';
import {putR2Object} from '../../lib/r2.js';
import {findModel,registry,operationFor,modelSettings,estimateCost,buildInput,validateSchema} from './model-registry.js';
import {paidGenerationApproved,replicateConfigured,createPrediction,getPrediction,cancelPrediction,downloadOutput} from './replicate-provider.js';
export function engineCatalog(kind,operations=[],snapshot=null){return registry.filter(m=>m.kind===kind&&!m.localOnly&&!m.fallbackOnly).map(m=>{
 const policy=snapshot?.policies?.find(p=>p.id===m.id),fresh=date=>date&&Date.now()-Date.parse(date)<31*86400000;
 const costs=Object.fromEntries(m.durations.map(d=>[d,operations.find(o=>o.id===operationFor(m,d))?.cost??null]));
 const configured=(m.kind==='image'?[undefined]:m.durations).every(d=>operations.some(o=>o.id===operationFor(m,d)));
 const verified=Boolean(policy?.schema?.input&&policy.schema_version&&fresh(policy.schema_verified_at));
 const priced=policy?.pricing?{...m,rates:policy.pricing,priceVerified:true,verifiedAt:policy.pricing_verified_at}:m;
 const available=Boolean((m.kind==='image'?launch.premiumImages:launch.video)&&launch.models[m.id]!==false&&m.model&&configured&&paidGenerationApproved()&&replicateConfigured()&&snapshot?.config?.enabled&&snapshot?.provider?.enabled&&policy?.enabled&&policy.acceptance_verified_at&&verified&&priced.priceVerified&&fresh(priced.verifiedAt));
 return {id:m.id,name:m.name,provider:'LOOX Cloud',operation:m.operation,cost:operations.find(o=>o.id===m.operation)?.cost??(Object.values(costs).some(Number.isSafeInteger)?Math.min(...Object.values(costs).filter(Number.isSafeInteger)):null),creditCosts:costs,minimumPlan:policy?.minimum_plan||m.minimumPlan,description:m.kind==='image'?'Image generation':'Video generation',available,status:available?'available':'coming_soon',reason:available?'Ready to generate.':'Cloud generation is being prepared for a future launch. No credits used.',durationOptions:verified?m.durations:[],imageRequired:!!m.imageRequired,
 settings:verified?m.allowedSettings:{},capabilities:{...(verified?m.capabilities:{ratios:[],startFrame:false,endFrame:false}),durations:verified?m.durations:[],resolution:verified?m.inputDefaults.resolution||'Model default':null,imageReference:verified&&m.capabilities.startFrame,schemaVerified:verified}};
 });}
async function record(job,user){return (await rows('engine_jobs',{job_id:'eq.'+job,...(user?{user_id:'eq.'+user}:{}),select:'*',limit:'1'}))[0];}
export async function engineStart(user,body,{acceptance=false}={}){
 need(paidGenerationApproved(),503,'Paid cloud generation is not approved. No credits used.');
 const model=findModel(body.model);need(model?.model&&!model.localOnly,503,'This exact cloud model is not verified. No credits used.');
 need((model.kind==='image'?launch.premiumImages:launch.video)&&launch.models[model.id]!==false,503,'This model is Coming Soon. No credits used.');
 need(!model.fallbackOnly||env.LOOX_FLUX_PAID_FALLBACK==='true'&&body.paidFallback===true,503,'Paid fallback is disabled.');
 need(uuid.test(body.requestId),400,'Invalid request ID.');
 const settings=modelSettings(model,body);
 const [policy]=await rows('engine_models',{id:'eq.'+model.id,select:'*',limit:'1'});
 need((acceptance||policy?.acceptance_verified_at)&&policy?.enabled&&policy.schema_verified_at&&policy.schema?.input&&policy.model_id===model.model,503,'This model has not completed configuration and verification. No credits used.');
 const priced=policy.pricing?{...model,rates:policy.pricing,priceVerified:true,verifiedAt:policy.pricing_verified_at}:model;
 const estimate=estimateCost(priced,body,settings);
 need(Date.now()-Date.parse(policy.schema_verified_at)<31*86400000,503,'Model schema needs verification.');
 const tier=await rpc('member_tier',{p_user:user.id});need(acceptance||tier!=='basic'&&tier!=='free',403,'Paid generation is unavailable on the free plan.');
 if(!acceptance&&policy.minimum_plan==='pro')need(tier==='pro',403,'This model requires a Pro or Business plan.');
 const digest=mac('engine:'+JSON.stringify({model:model.id,prompt:body.prompt.trim(),ratio:body.ratio,duration:body.duration,settings,image:body.image?mac(body.image):null,end:body.end_image?mac(body.end_image):null,seed:body.seed??null}));
 const operations=await rows('operations',{id:'eq.'+operationFor(model,body.duration),select:'id,cost'});const operation=operations[0];need(operation,503,'Credit pricing is unavailable.');
 need(body.expectedCredits==null||body.expectedCredits===operation.cost,409,'Credit price changed. Review the cost before generating.');
 const job=await rpc('engine_reserve',{p_user:user.id,p_request:body.requestId,p_digest:digest,p_model:model.id,p_operation:operation.id,p_credits:operation.cost,p_estimate:estimate.reservedMillicents,p_budget:Number(env.LOOX_DAILY_BUDGET_MILLICENTS)});
 if(!job.fresh)return {id:job.id};
 let first,last,submitting=false;
 try{
  const {prepareImage}=await import('../../lib/jobs.js');
  for(const [field,suffix] of [['image','-engine-start'],['end_image','-engine-end']])if(body[field]){const normalized=await prepareImage(body[field],4_000_000),key=userKey(user.id,'inputs',job.id,'image/png',suffix);await putR2Object(key,Buffer.from(normalized.uri.split(',')[1],'base64'),'image/png');if(field==='image')first=workerInputURL(key,3600);else last=workerInputURL(key,3600);}
  const input=validateSchema(buildInput(model,body,settings,first,last),policy.schema);
  const claimed=await rpc('engine_claim',{p_job:job.id});need(claimed===true,409,'This prediction is already being submitted.');
  const callback=new URL('https://looxtoolfree-backend.vercel.app/api/loox-prediction?engine=2');callback.searchParams.set('job',job.id);callback.searchParams.set('bind',mac('engine:'+job.id));
  submitting=true;
  const prediction=await createPrediction(model.model,input,{approved:true,version:policy.schema_version,webhook:callback.href});
  await rpc('engine_bind',{p_job:job.id,p_prediction:prediction.id});
  await supa('/rest/v1/loox_jobs?'+new URLSearchParams({id:'eq.'+job.id,user_id:'eq.'+user.id,state:'in.(reserved,processing)'}),{method:'PATCH',body:JSON.stringify({prompt:body.prompt.trim(),prediction:prediction.id,state:'processing'})});
  return {id:job.id};
 }catch(error){
  if(error.uncertain||submitting&&!error.rejected){await rpc('engine_uncertain',{p_job:job.id});return {id:job.id,pending_confirmation:true};}
  await rpc('engine_failed',{p_job:job.id}).catch(()=>{});
  if(error instanceof Problem)throw error;throw new Problem(503,'Generation could not start. No duplicate submission was attempted.');
 }
}
export async function engineStatus(user,id){
 need(uuid.test(id),400,'Invalid generation.');const submission=await record(id,user?.id);need(submission,404,'Generation not found.');
 let [job]=await rows('jobs',{id:'eq.'+id,user_id:'eq.'+submission.user_id,select:'*'});need(job,404,'Generation not found.');
 if(job.state==='succeeded'&&submission.status!=='succeeded')await rpc('engine_completed',{p_job:id,p_seconds:null});
 if(job.state==='failed'&&submission.status!=='failed')await rpc('engine_failed',{p_job:id});
 if(!['succeeded','failed'].includes(job.state)&&submission.prediction_id){
  const prediction=await getPrediction(submission.prediction_id);need(prediction.id===submission.prediction_id,503,'Prediction verification failed.');
  if(prediction.status==='succeeded'){
   const output=Array.isArray(prediction.output)?prediction.output[0]:prediction.output;need(typeof output==='string',502,'Model returned no output.');
   let bytes=await downloadOutput(output);const model=findModel(submission.model_id);let type;
   if(model.kind==='image'){bytes=await sharp(bytes,{limitInputPixels:20_000_000,failOn:'warning'}).rotate().png().toBuffer();type='image/png';}else{need(bytes.length>12&&bytes.toString('ascii',4,8)==='ftyp',422,'Invalid video output.');type='video/mp4';}
   const media=await saveGeneratedMedia({user:submission.user_id,id,bytes,type});await rpc('finish_media',{p_id:id,p_provider:'r2',p_key:media.key,p_thumbnail:media.thumbnail_key,p_type:media.type,p_bytes:media.bytes,p_sha256:media.sha256});
   await rpc('engine_completed',{p_job:id,p_seconds:Number.isFinite(prediction.metrics?.predict_time)?prediction.metrics.predict_time:null});
  }else if(['failed','canceled'].includes(prediction.status))await rpc('engine_failed',{p_job:id});
  [job]=await rows('jobs',{id:'eq.'+id,user_id:'eq.'+submission.user_id,select:'*'});
 }
 return {id,state:job.state,url:job.state==='succeeded'?await mediaURL(job):null,cost:job.cost,provider_cost_basis:'estimate_until_invoice_reconciliation'};
}
export async function engineRecord(id){return record(id);}
export async function engineCancel(user,id){const r=await record(id,user.id);need(r?.prediction_id,409,'This generation cannot be canceled yet.');await cancelPrediction(r.prediction_id);return engineStatus(user,id);}

export async function engineSnapshot(){if(!paidGenerationApproved())return null;const [config,policies,provider]=await Promise.all([rows('engine_config',{select:'*'}),rows('engine_models',{select:'id,enabled,minimum_plan,schema,schema_version,schema_verified_at,acceptance_verified_at,pricing,pricing_verified_at'}),rows('provider_limits',{provider:'eq.replicate',select:'enabled'})]);return {config:config[0],policies,provider:provider[0]};}
