import {readFileSync} from 'node:fs';
import {need} from '../../lib/core.js';
export const registry=JSON.parse(readFileSync(new URL('./model-registry.json',import.meta.url),'utf8'));
export const findModel=id=>registry.find(m=>m.id===id);
export function operationFor(model,duration){return model.creditsByDuration?model.operation+'_'+duration:model.operation;}
export function modelSettings(model,body){
 const settings={...(model.inputDefaults||{}),...(body.settings||{})};
 need(body.settings==null||body.settings&&typeof body.settings==='object'&&!Array.isArray(body.settings)&&Object.keys(body.settings).every(k=>model.allowedSettings[k]?.includes(body.settings[k])),400,'Unsupported model setting.');
 for(const key of ['resolution','audio'])if(body[key]!=null){need(model.allowedSettings[key]?.includes(body[key]),400,'Unsupported model setting.');settings[key]=body[key];}
 need(typeof body.prompt==='string'&&body.prompt.trim()&&body.prompt.length<=(model.kind==='video'?800:1200),400,'Enter a prompt within the supported length.');
 need(model.capabilities.ratios.includes(body.ratio),400,'Unsupported aspect ratio.');
 if(model.kind==='video')need(model.durations.includes(body.duration),400,'Unsupported video duration.');
 need(body.seed==null||Number.isSafeInteger(body.seed)&&body.seed>=0&&body.seed<=2147483647,400,'Invalid seed.');
 for(const key of ['references','reference_images','video_reference','reference_videos','quantity','num_outputs','provider','modelId','api_key','token'])need(body[key]==null,400,'Unsupported generation parameter.');
 need(!body.image||model.capabilities.startFrame,400,'This adapter does not accept a start frame.');need(!body.end_image||model.capabilities.endFrame&&body.image,400,'This adapter does not support the requested end frame.');need(!model.imageRequired||body.image,400,'A start frame is required.');
 if(model.id==='veo_31_lite'&&settings.resolution==='1080p')need(body.duration===8,400,'1080p requires an 8-second clip.');
 if(body.end_image&&model.id.startsWith('veo_'))need(body.duration===8,400,'End frames require an 8-second clip.');
 return settings;
}
export function estimateCost(model,body,settings=modelSettings(model,body)){
 need(model.priceVerified&&model.verifiedAt&&Date.now()-Date.parse(model.verifiedAt)<31*86400000,503,'Model pricing needs verification. No credits used.');
 const rate=model.rates.find(r=>Object.entries(r.criteria).every(([k,v])=>settings[k]===v));
 need(rate&&Number.isFinite(rate.usd)&&rate.usd>0,503,'This setting has no verified price. No credits used.');
 need(rate.unit!=='video'||rate.duration===body.duration,400,'This priced video length is not supported.');
 const usd=rate.usd*(rate.unit==='second'?body.duration:1);
 return {estimatedMillicents:Math.ceil(usd*100000),reservedMillicents:Math.ceil(usd*100000*1.2),basis:'published_price_estimate',rate};
}
export function buildInput(model,body,settings,first,last){
 const p=body.prompt.trim(),r=body.ratio,d=body.duration,id=model.id;
 let input={prompt:p,aspect_ratio:r};
 if(model.kind==='image'){
  for(const k of Object.keys(model.allowedSettings))if(settings[k]!=null)input[k]=settings[k];
  if(['bfl_flux2_pro','bfl_klein_4b','google_nano_2','google_nano_pro'].includes(id))input.resolution=settings.resolution;
  if(id==='google_nano_pro')input.allow_fallback_model=false;
  if(id==='replicate_hidream')input={prompt:p,resolution:'1024 × 1024 (Square)',model_type:'fast',output_format:'png'};
  if(id==='ideogram_45')input={prompt:p,quality:settings.quality||'medium',size:'source',num_images:1};
  if(id==='openai_gpt_image')input={...input,quality:settings.quality||'medium',number_of_images:1,output_format:'png'};
 }else{
  input.duration=d;
  if(settings.resolution)input.resolution=settings.resolution;
  if(id.startsWith('wan22_')){input={prompt:p,num_frames:81,frames_per_second:16,resolution:settings.resolution};if(id!=='wan22_i2v_fast')input.aspect_ratio=r;if(first)input.image=first;}
  else if(id==='kling_30')input={prompt:p,mode:'standard',duration:d,aspect_ratio:r,generate_audio:settings.audio===true,...(first?{start_image:first}:{}),...(last?{end_image:last}:{})};
  else if(id.startsWith('kling_40'))input={...input,...(first?{start_image:first}:{}),...(last?{end_image:last}:{})};
  else if(id.startsWith('seedance_'))input={...input,generate_audio:true,aspect_ratio:first?'adaptive':r,...(first?{image:first}:{}),...(last?{last_frame_image:last}:{})};
  else if(id.startsWith('veo_'))input={...input,...(id!=='veo_31_lite'?{generate_audio:settings.audio===true}:{}),...(first?{image:first}:{}),...(last?{last_frame:last}:{})};
  else if(id.startsWith('minimax_h3'))input={prompt:p,duration:d,resolution:settings.resolution,ratio:first?'adaptive':r,...(first?{first_frame_image:first}:{}),...(last?{last_frame_image:last}:{})};
  else if(id==='luma_ray2')input={prompt:p,duration:d,aspect_ratio:r,...(first?{start_image:first}:{}),...(last?{end_image:last}:{})};
  else input={...input,...(first?{image:first}:{}),...(id==='wan26_i2v_flash'?{audio_enabled:false}:{}),...(id==='wan_30'?{enable_prompt_expansion:false}:{})};
 }
 if(body.seed!=null)input.seed=body.seed;
 return input;
}
export function validateSchema(input,schema){
 const root=schema.input||schema,components=schema.components||{};
 const resolve=(rule,depth=0)=>{need(depth<12&&rule,503,'Model schema could not be resolved.');return rule.$ref?resolve(components[rule.$ref.split('/').at(-1)],depth+1):rule;};
 function valid(value,raw,depth=0){
  if(depth>12)return false;const r=resolve(raw);
  if(r.allOf&&!r.allOf.every(v=>valid(value,v,depth+1)))return false;
  if(r.anyOf&&!r.anyOf.some(v=>valid(value,v,depth+1)))return false;
  if(r.oneOf&&r.oneOf.filter(v=>valid(value,v,depth+1)).length!==1)return false;
  if(r.enum&&!r.enum.includes(value))return false;
  if(r.type==='integer'&&!Number.isSafeInteger(value)||r.type==='number'&&!(typeof value==='number'&&Number.isFinite(value))||r.type==='boolean'&&typeof value!=='boolean'||r.type==='string'&&typeof value!=='string'||r.type==='array'&&!Array.isArray(value))return false;
  if(r.minimum!=null&&value<r.minimum||r.maximum!=null&&value>r.maximum)return false;
  if(typeof value==='string'&&(r.minLength!=null&&value.length<r.minLength||r.maxLength!=null&&value.length>r.maxLength))return false;
  if(Array.isArray(value)&&(r.maxItems!=null&&value.length>r.maxItems||r.minItems!=null&&value.length<r.minItems||r.items&&!value.every(v=>valid(v,r.items,depth+1))))return false;
  return true;
 }
 for(const counter of ['num_outputs','num_images','number_of_images','max_images'])if(root.properties?.[counter])input[counter]=1;
 for(const k of root.required||[])need(input[k]!=null,400,'A required model input is missing.');
 for(const [key,value] of Object.entries(input)){const rule=root.properties?.[key];need(rule,400,'This input is not supported by the verified model schema.');need(valid(value,rule),400,'Unsupported model input value.');}
 return input;
}
