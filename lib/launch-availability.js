import {rows,aiReady} from './core.js';
import {launch} from '../src/config/launch.js';
import {cloudflareImageReady,CLOUDFLARE_FLUX_DAILY_CAP} from './cloudflare-image.js';
export async function freeImageAvailability(worker,blocked=[]){
 const paused=new Set(blocked),fresh=aiReady()&&worker&&Date.now()-Date.parse(worker.last_seen)<90000;
 const local=op=>Boolean(launch.localImages&&fresh&&worker.modes?.includes(op)&&!paused.has(op));
 let cloud=cloudflareImageReady();
 if(cloud){try{const [usage]=await rows('limits',{key:'eq.cloudflare-flux-free:'+new Date().toISOString().slice(0,10),select:'used,expires_at'});cloud=!usage||Date.parse(usage.expires_at)<=Date.now()||usage.used<CLOUDFLARE_FLUX_DAILY_CAP;}catch{cloud=false;}}
 const fluxLocal=launch.models.flux&&local('generate'),available=Boolean(launch.models.flux&&!paused.has('generate')&&(fluxLocal||cloud));
 return {code:available?(fluxLocal?'B8':'A8'):'--',available,status:paused.has('generate')?'maintenance':available?'available':'temporarily_offline',referenceAvailable:Boolean(fluxLocal&&local('generate_reference')),zImage:{available:Boolean(launch.models.z_image_turbo&&local('generate_z_image')),code:local('generate_z_image')?'B8':null,status:paused.has('generate_z_image')?'maintenance':local('generate_z_image')?'available':'temporarily_offline'},klein:{available:Boolean(launch.models.flux2_klein_local_edit&&local('generate_flux2_klein_edit')),status:paused.has('generate_flux2_klein_edit')?'maintenance':local('generate_flux2_klein_edit')?'available':'temporarily_offline'}};
}
export async function launchBlocked(){return Promise.all([rows('model_circuits',{select:'operation',paused_until:'gt.'+new Date().toISOString()}),rows('cost_controls',{select:'disabled_operations'})]).then(([circuits,controls])=>[...circuits.map(c=>c.operation),...(controls[0]?.disabled_operations||[])]);}
