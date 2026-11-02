import {handler} from '../lib/core.js';
export default handler(async(req,res)=>{
 if(req.method==='GET')return res.status(200).json({tasks:[],providers:{}});
 res.status(410).json({error:'Use the authenticated AI workspace.'});
});
