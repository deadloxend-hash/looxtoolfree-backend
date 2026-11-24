import {rows,supa,rpc,need,method,json,limit,uuid} from '../../lib/core.js';
import {registry,findModel,modelSettings,estimateCost,buildInput,validateSchema} from './model-registry.js';
import {getModelSchema,paidGenerationApproved,replicateConfigured} from './replicate-provider.js';
import {engineStart} from './engine.js';
export async function engineAdmin(req,res,user,identity){
 need(identity.role==='owner',403,'Only the owner can manage cloud generation.');
 const action=req.query.action;await limit(user,'engine-admin',30,60);
 if(action==='engine_models'){
  method(req,'GET');const [policies,config,provider,operations,stats]=await Promise.all([rows('engine_models',{select:'id,model_id,enabled,minimum_plan,pricing,pricing_verified_at,pricing_source,schema_version,schema_verified_at,acceptance_verified_at,daily_millicents,monthly_millicents,maximum_millicents,max_concurrent'}),rows('engine_config',{select:'*'}),rows('provider_limits',{provider:'eq.replicate',select:'*'}),rows('operations',{select:'id,cost,max_millicents'}),rpc('engine_model_stats',{})]);
  return res.json({name:'LOOX Unified AI Engine 2.0',paidApproved:paidGenerationApproved(),tokenConfigured:replicateConfigured(),config:config[0],provider:provider[0],models:registry.map(m=>({...m,policy:policies.find(p=>p.id===m.id)||null,metrics:stats.find(s=>s.id===m.id)||null,operations:operations.filter(o=>o.id===m.operation||o.id.startsWith(m.operation+'_'))})),balanceMonitoring:{supported:false,note:'No verified provider balance API is configured. This is not a zero balance.'}});
 }
 method(req,'POST');const body=json(req);need(typeof body.reason==='string'&&body.reason.trim().length>=8&&body.reason.length<=240,400,'Provide a specific management reason.');
 const audit=async()=>supa('/rest/v1/loox_admin_audit',{method:'POST',body:JSON.stringify({actor:user.id,action,target:body.id||'engine',reason:body.reason.trim(),detail:{}})});
 if(action==='engine_pause'){await supa('/rest/v1/loox_engine_config?id=eq.true',{method:'PATCH',body:JSON.stringify({enabled:false})});await audit();return res.json({paused:true});}
 if(action==='engine_verify'){
  const m=findModel(body.id);need(m?.model&&!m.localOnly,400,'No verified exact Replicate identifier.');const schema=await getModelSchema(m.model);
  // Non-billable schema checks, not a prediction or a claim that paid execution succeeded.
  const input=buildInput(m,{prompt:'Schema validation only',ratio:m.capabilities.ratios[0],duration:m.durations[0]},m.inputDefaults,m.imageRequired?'https://example.invalid/owned-frame.png':undefined);
  validateSchema(input,schema);
  // Validate every exposed scalar choice, duration and ratio before recording metadata success.
  const settingsList=Object.entries(m.allowedSettings).reduce((list,[key,values])=>list.flatMap(s=>values.map(v=>({...s,[key]:v}))),[{...m.inputDefaults}]);
  for(const settings of settingsList)for(const ratio of m.capabilities.ratios)for(const duration of m.kind==='video'?m.durations:[undefined]){
   if(m.id==='veo_31_lite'&&settings.resolution==='1080p'&&duration!==8)continue;
   validateSchema(buildInput(m,{prompt:'Schema validation only',ratio,duration},settings,m.imageRequired?'https://example.invalid/owned-frame.png':undefined),schema);
  }
  await supa('/rest/v1/loox_engine_models?id=eq.'+m.id,{method:'PATCH',body:JSON.stringify({schema,schema_version:schema.version,schema_verified_at:schema.verifiedAt,acceptance_verified_at:null,enabled:false})});await audit();return res.json({metadataVerified:true,schemaVersion:schema.version,paidAcceptanceVerified:false});
 }
 if(action==='engine_limits'){
  const keys=['user_daily_millicents','user_monthly_millicents','proposed_monthly_millicents'];need(keys.every(k=>Number.isSafeInteger(body[k])&&body[k]>0&&body[k]<=10000000)&&Number.isInteger(body.max_concurrent)&&body.max_concurrent>=1&&body.max_concurrent<=20,400,'Invalid spending limits.');
  need(body.user_daily_millicents<=body.user_monthly_millicents&&body.user_monthly_millicents<=body.proposed_monthly_millicents,400,'Daily and user limits must fit within the monthly budget.');
  need(body.enabled!==true||paidGenerationApproved(),403,'Paid spending has not been approved.');const values=Object.fromEntries([...keys,'max_concurrent'].map(k=>[k,body[k]]));values.enabled=body.enabled===true;
  await supa('/rest/v1/loox_engine_config?id=eq.true',{method:'PATCH',body:JSON.stringify(values)});await audit();return res.json({saved:true});
 }
 if(action==='engine_model_policy'){
  const m=findModel(body.id);need(m,400,'Unknown model.');need(['creator','pro'].includes(body.minimum_plan)&&['daily_millicents','monthly_millicents','maximum_millicents'].every(k=>Number.isSafeInteger(body[k])&&body[k]>0&&body[k]<=10000000)&&Number.isInteger(body.max_concurrent)&&body.max_concurrent>=1&&body.max_concurrent<=10,400,'Invalid model limits.');
  need(body.maximum_millicents<=body.daily_millicents&&body.daily_millicents<=body.monthly_millicents,400,'Maximum must fit daily and monthly limits.');need(body.enabled!==true||paidGenerationApproved()&&m.model&&m.priceVerified,403,'This cloud model cannot be enabled.');
  await supa('/rest/v1/loox_engine_models?id=eq.'+m.id,{method:'PATCH',body:JSON.stringify(Object.fromEntries(['minimum_plan','daily_millicents','monthly_millicents','maximum_millicents','max_concurrent','enabled'].map(k=>[k,k==='enabled'?body[k]===true:body[k]])))});await audit();return res.json({saved:true});
 }
 if(action==='engine_pricing'){
  const m=findModel(body.id);need(m?.model&&body.source===m.source&&Array.isArray(body.rates)&&body.rates.length>0&&body.rates.length<=100,400,'Provide the exact Replicate pricing source and price variants.');
  need(body.rates.every(r=>r&&Number.isFinite(r.usd)&&r.usd>0&&r.usd<=100&&['image','second','video'].includes(r.unit)&&r.criteria&&typeof r.criteria==='object'&&!Array.isArray(r.criteria)&&Object.entries(r.criteria).every(([k,v])=>m.allowedSettings[k]?.includes(v))&&(r.unit!=='video'||m.durations.includes(r.duration))),400,'Invalid pricing variants.');
  const rates=body.rates.map(r=>({criteria:r.criteria,usd:r.usd,unit:r.unit,...(r.unit==='video'?{duration:r.duration}:{})}));
  await supa('/rest/v1/loox_engine_models?id=eq.'+m.id,{method:'PATCH',body:JSON.stringify({pricing:rates,pricing_verified_at:new Date().toISOString(),pricing_source:body.source,enabled:false})});await audit();return res.json({saved:true,enabled:false,note:'Provider pricing updated. Credit charges were not changed. Model paused for review.'});
 }
 if(action==='engine_invoice'){need(uuid.test(body.job)&&Number.isSafeInteger(body.actualMillicents)&&body.actualMillicents>=0&&typeof body.reference==='string',400,'Invalid invoice reconciliation.');await rpc('engine_invoice',{p_job:body.job,p_actual:body.actualMillicents,p_reference:body.reference});await audit();return res.json({reconciled:true});}
 if(action==='engine_smoke'){need(paidGenerationApproved(),403,'Billable acceptance testing has not been approved.');await audit();return res.json(await engineStart(user,body,{acceptance:true}));}
 need(false,400,'Unknown engine action.');
}
