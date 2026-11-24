import {method,need,raw,uuid,mac,equal,rpc} from '../lib/core.js';
import {verifyWebhook,webhookSigningSecret,getPrediction} from '../src/ai/replicate-provider.js';
import {engineRecord,engineStatus} from '../src/ai/engine.js';
export async function handleEngineWebhook(req,res){
 method(req,'POST');const id=req.query.job;
 need(uuid.test(id)&&typeof req.query.bind==='string'&&equal(req.query.bind,mac('engine:'+id)),403,'Invalid callback.');
 const bytes=await raw(req,1_000_000);verifyWebhook(bytes,req.headers,await webhookSigningSecret());
 let body;try{body=JSON.parse(bytes);}catch{need(false,400,'Invalid callback.');}
 const entry=await engineRecord(id);need(entry,404,'Generation not found.');
 if(['succeeded','failed'].includes(entry.status))return res.status(204).end();
 need(typeof body.id==='string'&&(!entry.prediction_id||entry.prediction_id===body.id),403,'Prediction mismatch.');
 // A signed delivery can arrive before the create response. Confirm through the API.
 const prediction=await getPrediction(body.id);need(prediction.id===body.id,403,'Prediction mismatch.');
 if(prediction.model){const {findModel}=await import('../src/ai/model-registry.js');need(prediction.model===findModel(entry.model_id)?.model,403,'Prediction model mismatch.');}
 await rpc('engine_bind',{p_job:id,p_prediction:body.id});
 await engineStatus({id:entry.user_id},id);
 res.status(204).end();
}
