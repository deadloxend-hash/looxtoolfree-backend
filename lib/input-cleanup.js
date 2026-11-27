import {userKey} from './media-store.js';
// A failed object deletion must remain retryable; never mark the whole batch clean.
export async function cleanupInputs(jobs,{removeLegacy,removeObject,markClean}){
 if(!jobs.length)return {cleaned:0,pending:0};
 const legacy=jobs.flatMap(j=>['image','mask','target_image','swap_image','reference_image'].map(f=>j.user_id+'/'+j.id+'-'+f+'.png'));
 await removeLegacy(legacy);
 const failed=new Set(),tasks=jobs.flatMap(j=>['target_image','swap_image','reference_image','video-source','video-end','engine-start','engine-end'].map(f=>({id:j.id,key:userKey(j.user_id,'inputs',j.id,'image/png','-'+f)})));
 for(let i=0;i<tasks.length;i+=10){const batch=tasks.slice(i,i+10),results=await Promise.allSettled(batch.map(t=>removeObject(t.key)));results.forEach((r,n)=>{if(r.status==='rejected')failed.add(batch[n].id);});}
 const ids=jobs.filter(j=>!failed.has(j.id)).map(j=>j.id);
 if(ids.length)await markClean(ids);
 return {cleaned:ids.length,pending:failed.size};
}
