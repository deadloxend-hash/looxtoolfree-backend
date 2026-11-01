/* Deprecated Magic Hour endpoint. Disabled permanently until replaced with another implementation. */
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS')return res.status(204).end();
 return res.status(410).json({error:'The previous face-swap provider has been removed. This endpoint is unavailable.'});
}
