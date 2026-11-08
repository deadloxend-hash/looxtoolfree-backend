import {equal,handler,mac,method,need} from '../lib/core.js';
import {getR2Object} from '../lib/r2.js';

export default handler(async(req,res)=>{
 method(req,'GET');
 const key=String(req.query.path||''),exp=Number(req.query.exp),sig=String(req.query.sig||'');
 need(/^users\/[a-f0-9-]{36}\/inputs\/[a-z0-9._-]+$/i.test(key)&&Number.isInteger(exp)&&exp>=Math.floor(Date.now()/1000)&&exp<=Math.floor(Date.now()/1000)+7205,403,'Worker media link expired.');
 need(/^[a-f0-9]{64}$/.test(sig)&&equal(sig,mac('worker-media:'+key+':'+exp)),403,'Invalid worker media link.');
 const media=await getR2Object(key);need(media.type==='image/png'&&media.bytes.length<=8_000_000,415,'Worker input is invalid.');
 res.setHeader('Content-Type','image/png');res.setHeader('Content-Length',String(media.bytes.length));res.setHeader('Cache-Control','private, no-store');return res.end(media.bytes);
},{cors:false});
