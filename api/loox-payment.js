import {handler,method,raw,env,need,equal,mac,billingReady} from '../lib/core.js';
import {billingEvent} from '../lib/billing.js';
export const config={api:{bodyParser:false}};
export default handler(async(req,res)=>{
 method(req,'POST');need(billingReady(),503,'Billing setup is pending.');
 const body=await raw(req);
 need(equal(req.headers['x-signature'],mac(body,env.LEMON_WEBHOOK_SECRET)),403,'Invalid signature.');
 await billingEvent(JSON.parse(body));res.status(204).end();
},{cors:false});
