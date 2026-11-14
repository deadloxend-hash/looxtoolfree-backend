// The database reservation guard remains authoritative; this only explains availability.
export function applyModelHealth(config,operations){
 const paused=new Set(operations),unavailable={available:false,status:'temporarily_unavailable',reason:'Temporarily unavailable. Try another model.'};
 if(paused.has('generate')){config.local.available=false;config.local.code='--';}
 if(paused.has('generate_reference'))config.local.referenceAvailable=false;
 config.models=config.models.map(m=>paused.has(m.operation)?{...m,...unavailable}:m);
 config.videoModels=config.videoModels.map(m=>{
  if(paused.has(m.operation))return {...m,...unavailable};
  const durations=(m.durationOptions||[]).filter(d=>!paused.has(m.operation+'_'+d));
  if(!durations.length&&m.durationOptions?.length)return {...m,...unavailable};
  return {...m,durationOptions:durations};
 });
 if(paused.has('face_swap'))config.faceSwap.available=false;
 return config;
}
