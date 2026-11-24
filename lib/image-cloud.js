import {need,rows,Problem} from './core.js';
import {engineStart,engineCatalog} from '../src/ai/engine.js';
import {registry} from '../src/ai/model-registry.js';

export const cloudOperations=[...new Set(['generate_replicate','generate_google','generate_bfl','generate_ideogram','generate_stability','generate_byteplus','generate_openai',...registry.filter(m=>m.kind==='image').map(m=>m.operation)])];
export const imageCatalog=(operations=[],snapshot=null)=>engineCatalog('image',operations,snapshot).concat([{id:'z_image_turbo',provider:'LOOX Studio',name:'Z-Image Turbo',operation:'generate_z_image',cost:operations.find(o=>o.id==='generate_z_image')?.cost??3,description:'Fast image generation',available:false,status:'coming_soon',reason:'The local worker is not available.'}]);
export async function cloudJob(user,body){
 if(body.model==='z_image_turbo'){
  const [health]=await rows('local_worker_health',{id:'eq.1',select:'modes,last_seen'});
  if(health?.modes?.includes('generate_z_image')&&Date.now()-Date.parse(health.last_seen)<90000){const {start}=await import('./jobs.js');return start(user,{...body,operation:'generate_z_image'});}
  throw new Problem(503,'Z-Image Turbo requires the local worker. No credits used.');
 }
 return engineStart(user,body);
}
