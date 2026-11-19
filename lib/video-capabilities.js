// Adapter capabilities: intentionally limited to existing, priced operations.
// Provider features requiring new cost/entitlement rules stay unavailable here.
// Source schemas checked 2026-11-19; URLs are recorded for re-verification.
const wides=['16:9','9:16'],standard=[...wides,'1:1','4:3','3:4'];
const descriptor=(slug,options={})=>({provider:'Replicate',modelVersion:slug,source:'https://replicate.com/'+slug+'/api/schema',verifiedAt:'2026-11-19',textToVideo:true,imageToVideo:true,startFrame:true,endFrame:false,referenceImages:false,videoToVideo:false,videoEditing:false,audioGeneration:false,audioSelectable:false,cancel:false,maxReferenceUploads:1,requiredInputs:['prompt'],ratios:standard,resolutions:['720p'],resolution:'720p',arbitraryDimensions:false,...options});
const registry={
 wan22_i2v_fast:descriptor('wan-video/wan-2.2-i2v-fast',{textToVideo:false,requiredInputs:['prompt','startFrame'],ratioMode:'source_image',resolution:'Source frame · 480p class',resolutions:['480p']}),
 wan22_5b_fast:descriptor('wan-video/wan-2.2-5b-fast',{ratios:wides,resolution:'832×480 / 480×832',resolutions:['480p']}),
 wan22_t2v_fast:descriptor('wan-video/wan-2.2-t2v-fast',{imageToVideo:false,startFrame:false,maxReferenceUploads:0,ratios:wides,resolution:'832×480 / 480×832',resolutions:['480p']}),
 wan25_i2v:descriptor('wan-video/wan-2.5-i2v',{textToVideo:false,requiredInputs:['prompt','startFrame'],ratioMode:'source_image'}),
 wan26_i2v_flash:descriptor('wan-video/wan2.6-i2v-flash',{textToVideo:false,requiredInputs:['prompt','startFrame'],ratioMode:'source_image'}),
 kling_30:descriptor('kwaivgi/kling-v3-video',{endFrame:true,maxReferenceUploads:2,ratios:[...wides,'1:1']}),
 seedance_20:descriptor('bytedance/seedance-2.0',{audioGeneration:true,audioMode:'included'}),
 veo_31_fast:descriptor('google/veo-3.1-fast',{endFrame:true,endFrameDurations:[8],maxReferenceUploads:2,ratios:wides}),
 runway_45:descriptor('runwayml/gen-4.5',{ratios:wides}),
 kling_40:descriptor('kwaivgi/kling-v4.0',{audioGeneration:true,audioMode:'included',endFrame:true,maxReferenceUploads:2,ratios:[...wides,'1:1']}),
 kling_40_flash:descriptor('kwaivgi/kling-v4-flash',{audioGeneration:true,audioMode:'included',ratios:[...wides,'1:1']}),
 seedance_25:descriptor('bytedance/seedance-2.5',{endFrame:true,maxReferenceUploads:2,audioGeneration:true,audioMode:'included',ratioMode:'adaptive_with_image'}),
 seedance_20_fast:descriptor('bytedance/seedance-2.0-fast',{endFrame:true,maxReferenceUploads:2,audioGeneration:true,audioMode:'included',ratioMode:'adaptive_with_image'}),
 grok_video:descriptor('xai/grok-imagine-video',{audioGeneration:true,audioMode:'included'}),
 veo_31:descriptor('google/veo-3.1',{endFrame:true,endFrameDurations:[8],maxReferenceUploads:2,ratios:wides,audioGeneration:true,audioMode:'included'}),
 veo_31_lite:descriptor('google/veo-3.1-lite',{endFrame:true,endFrameDurations:[8],maxReferenceUploads:2,ratios:wides}),
 minimax_h3:descriptor('minimax/h3',{endFrame:true,maxReferenceUploads:2,resolutions:['768P'],resolution:'768P',ratioMode:'adaptive_with_image',audioGeneration:true,audioMode:'included'}),
 minimax_h3_lite:descriptor('minimax/h3-lite',{endFrame:true,maxReferenceUploads:2,resolutions:['768P'],resolution:'768P',ratioMode:'adaptive_with_image',audioGeneration:true,audioMode:'included'}),
 wan_30:descriptor('alibaba/wan-3',{ratioMode:'source_image'}),
 luma_ray2:descriptor('luma/ray-2-720p',{endFrame:true,maxReferenceUploads:2})
};
export function videoCapabilities(id){
 const c=registry[id];
 if(!c)return {textToVideo:false,imageToVideo:false,startFrame:false,imageReference:false,endFrame:false,referenceImages:false,videoReference:false,videoToVideo:false,videoEditing:false,audioGeneration:false,maxReferenceUploads:0,ratios:[],resolutions:[],resolution:'Unverified',arbitraryDimensions:false};
 return {...c,ratios:[...c.ratios],imageReference:c.startFrame,videoReference:false};
}
export const hasVerifiedAdapter=id=>Object.hasOwn(registry,id);
