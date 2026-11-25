import {createHmac,timingSafeEqual} from 'node:crypto';
import {env,need,Problem} from '../../lib/core.js';
import {launch} from '../config/launch.js';
const origin='https://api.replicate.com/v1/';
const identifier=/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/;
const predictionId=/^[a-zA-Z0-9_-]{1,100}$/;
export const paidGenerationApproved=()=>(launch.premiumImages||launch.video)&&env.LOOX_PAID_GENERATION_APPROVED==='true';
export const replicateConfigured=()=>Boolean(env.REPLICATE_API_TOKEN?.trim());
export class SubmissionUncertain extends Problem{constructor(){super(503,'The provider may have accepted this request. Do not submit it again; check generation history.');this.uncertain=true;}}
export async function providerRequest(path,options={},request=fetch){
 if(options.method==='POST'&&(/(?:^|\/)predictions$/.test(path)))need(launch.premiumImages||launch.video,503,'Premium models are Coming Soon. No credits used.');
 need(!path.startsWith('/')&&!path.includes('..')&&!path.includes('?')&&/^[\w./-]+$/.test(path),400,'Invalid provider path.');
 need(replicateConfigured(),503,'Cloud generation is not configured.');
 return request(origin+path,{...options,headers:{Authorization:'Bearer '+env.REPLICATE_API_TOKEN,...options.headers},redirect:'error',signal:AbortSignal.timeout(20000)});
}
export async function createPrediction(model,input,{webhook,version,approved=false,request=fetch}={}){
 need(approved&&paidGenerationApproved(),503,'Paid cloud generation is not approved. No credits used.');
 need(identifier.test(model),400,'Invalid model identifier.');
 need(version==null||/^[a-f0-9]{64}$/.test(version),400,'Invalid verified model version.');
 const body={input,...(version?{version}:{})};if(webhook)body.webhook=webhook,body.webhook_events_filter=['completed'];
 let response;try{response=await providerRequest(version?'predictions':'models/'+model+'/predictions',{method:'POST',headers:{'Content-Type':'application/json','Cancel-After':'30m'},body:JSON.stringify(body)},request);}catch{throw new SubmissionUncertain();}
 if(response.status>=500)throw new SubmissionUncertain();
 if(!response.ok){const error=new Problem(response.status===429?429:503,response.status===402?'Provider balance is insufficient.':response.status===429?'The model is rate limited. Please try later.':'The model could not accept this request.');error.rejected=true;throw error;}
 let result;try{result=await response.json();}catch{throw new SubmissionUncertain();}
 if(!predictionId.test(result?.id||''))throw new SubmissionUncertain();return result;
}
export async function getPrediction(id,{request=fetch}={}){need(predictionId.test(id),400,'Invalid prediction.');let response;for(let attempt=0;attempt<2;attempt++){response=await providerRequest('predictions/'+id,{},request);if(response.ok)break;if(![429,502,503,504].includes(response.status)||attempt)break;await new Promise(r=>setTimeout(r,250));}need(response.ok,503,'Prediction status is temporarily unavailable.');return response.json();}
export async function cancelPrediction(id,{request=fetch}={}){need(predictionId.test(id),400,'Invalid prediction.');const r=await providerRequest('predictions/'+id+'/cancel',{method:'POST'},request);need(r.ok,503,'Cancellation could not be confirmed. Check generation history.');return r.json();}
export async function getModelSchema(model,{request=fetch}={}){need(identifier.test(model),400,'Invalid model identifier.');const r=await providerRequest('models/'+model,{},request);need(r.ok,503,'Model metadata could not be verified.');const m=await r.json();const version=m.latest_version;need(version?.id&&version.openapi_schema?.components?.schemas?.Input,503,'The current model schema is unavailable.');return {version:version.id,input:version.openapi_schema.components.schemas.Input,components:version.openapi_schema.components.schemas,verifiedAt:new Date().toISOString()};}
let secretCache=null;
export async function webhookSigningSecret({request=fetch}={}){if(env.REPLICATE_WEBHOOK_SIGNING_SECRET)return env.REPLICATE_WEBHOOK_SIGNING_SECRET;if(secretCache&&secretCache.expires>Date.now())return secretCache.key;const r=await providerRequest('webhooks/default/secret',{},request);need(r.ok,503,'Callback verification is unavailable.');const b=await r.json();need(typeof b.key==='string'&&b.key.startsWith('whsec_'),503,'Callback verification is unavailable.');secretCache={key:b.key,expires:Date.now()+300000};return b.key;}
export function verifyWebhook(raw,headers,secret,now=Date.now()){
 const id=headers['webhook-id'],timestamp=headers['webhook-timestamp'],signatures=headers['webhook-signature'];
 need(typeof id==='string'&&id.length<=200&&/^\d{10}$/.test(timestamp||'')&&Math.abs(now/1000-Number(timestamp))<=300&&typeof signatures==='string'&&signatures.length<=2048,403,'Invalid callback.');
 need(typeof secret==='string'&&/^whsec_[A-Za-z0-9+/=]+$/.test(secret),503,'Callback verification is unavailable.');
 const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(id+'.'+timestamp+'.').update(raw).digest();
 const valid=signatures.split(' ').some(part=>{if(!part.startsWith('v1,'))return false;const bytes=Buffer.from(part.slice(3),'base64');return bytes.length===expected.length&&timingSafeEqual(bytes,expected);});need(valid,403,'Invalid callback.');return id;
}
// No redirects, credentials, arbitrary hosts, or unbounded buffering.
export async function downloadOutput(url,{request=fetch,maxBytes=40_000_000}={}){let u;try{u=new URL(url);}catch{throw new Problem(502,'Invalid model output.');}need(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='replicate.delivery'||u.hostname.endsWith('.replicate.delivery')),502,'Unexpected model output host.');const r=await request(u,{redirect:'error',signal:AbortSignal.timeout(45000)});need(r.ok&&r.body,503,'Model output is not ready.');const size=Number(r.headers.get('content-length'));need(!Number.isFinite(size)||size<=maxBytes,422,'Model output is too large.');let total=0;const chunks=[];for await(const chunk of r.body){total+=chunk.length;need(total<=maxBytes,422,'Model output is too large.');chunks.push(chunk);}need(total>0,422,'Model output is empty.');return Buffer.concat(chunks);}
