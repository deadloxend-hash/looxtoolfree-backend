// Owner-controlled release policy. Browser flags and legacy env opt-ins cannot override it.
export const launch=Object.freeze({payments:false,subscriptions:false,creditPurchases:false,
 premiumImages:false,localImages:true,cloudflareImages:true,video:false,dailyImages:25,
 models:Object.freeze({flux:true,z_image_turbo:true,flux2_klein_local_edit:true})});
export const premiumMessage='Premium plans are coming soon. Enjoy our available AI tools for free while we prepare the next generation of LOOX AI.';
export const videoMessage="AI Video is coming soon. We're preparing a powerful video creation experience for you.";
export function launchCatalog(config,policy=launch){
 config.launch=policy;config.billing=Boolean(config.billing&&policy.payments);if(!config.billing||!policy.subscriptions)config.checkoutPlans=[];
 const localIds=new Set(['z_image_turbo','flux2_klein_local_edit']);
 config.local.available=Boolean(config.local.available&&policy.models.flux);
 config.local.status=config.local.status==='maintenance'?'maintenance':config.local.available?'available':'temporarily_offline';
 config.models=config.models.map(m=>localIds.has(m.id)?{...m,available:Boolean(m.available&&policy.localImages&&policy.models[m.id]),status:m.status==='maintenance'?'maintenance':m.available&&policy.localImages&&policy.models[m.id]?'available':'temporarily_offline',reason:m.available?'Ready to create.':'Temporarily Offline. Try again later.'}:policy.premiumImages&&policy.models[m.id]!==false?m:{...m,available:false,status:'coming_soon',reason:'Coming Soon. No credits used.',verificationLabel:null});
 config.videoModels=config.videoModels.map(m=>policy.video&&policy.models[m.id]!==false?m:({...m,available:false,status:'coming_soon',reason:videoMessage,verificationLabel:null}));
 return config;
}
