/* Magic Hour job polling removed. This endpoint is no longer available. */
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
 const origin=req.headers.origin,allow=(process.env.MEDIA_AI_ORIGINS||'https://deadloxend-hash.github.io').split(',').map(s=>s.trim());
 if(origin&&allow.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}
 if(req.method==='OPTIONS')return res.status(204).end();
 return res.status(410).json({error:'This AI job provider has been removed.'});
}
