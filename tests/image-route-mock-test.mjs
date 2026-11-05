import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('lib/image-cloud.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/0QAAAABJRU5ErkJggg==','base64');
const calls=[];
const env=Object.fromEntries(['GOOGLE','BFL','IDEOGRAM','STABILITY','BYTEPLUS','OPENAI','REPLICATE'].map(x=>['LOOX_IMAGE_'+x+(x==='REPLICATE'?'_API_TOKEN':'_API_KEY'),'TEST_ONLY']));
class Problem extends Error {constructor(status,message){super(message);this.status=status}}
const need=(yes,status,message)=>{if(!yes)throw new Problem(status,message)};
const fetch=async(url,options={})=>{
 calls.push({url,options});
 if(url.startsWith('https://api.bfl.ai/v1/get_result'))return response({status:'Ready',result:{sample:'https://example.bfl.ai/result.png'}});
 if(url.includes('api.bfl.ai/v1/'))return response({id:'mock',polling_url:'https://api.bfl.ai/v1/get_result?id=mock'});
 if(url.includes('api.openai.com'))return response({data:[{b64_json:png.toString('base64')}]});
 if(url.includes('generativelanguage.googleapis.com'))return response({candidates:[{content:{parts:[{inlineData:{data:png.toString('base64')}}]}}]});
 if(url.includes('api.ideogram.ai'))return response({data:[{url:'https://example.ideogram.ai/result.png',is_image_safe:true}]});
 if(url.includes('ark.ap-southeast.bytepluses.com'))return response({data:[{b64_json:png.toString('base64')}]});
 if(url.includes('api.replicate.com'))return response({status:'succeeded',output:'https://replicate.delivery/result.png'});
 if(url.includes('api.stability.ai'))return {ok:true,arrayBuffer:async()=>png};
 if(url.includes('replicate.delivery')||url.includes('example.ideogram.ai')||url.includes('example.bfl.ai'))return {ok:true,arrayBuffer:async()=>png};
 throw Error('Unexpected URL '+url);
};
const response=value=>({ok:true,json:async()=>value,arrayBuffer:async()=>png});
const context={Buffer,URL,FormData,AbortSignal,fetch,env,need,Problem,setTimeout,sharp:null,rows:null,rpc:null,supa:null,mac:null,uuid:null,authReady:null};
vm.runInNewContext(source+'\nglobalThis.testRoutes={catalog,imageBytes,imageCatalog};',context);
const {catalog,imageBytes,imageCatalog}=context.testRoutes;
assert.equal(catalog.length,16);
assert.equal(imageCatalog([]).filter(x=>x.available).length,0);
assert.equal(imageCatalog(catalog.map(m=>({id:m.operation,cost:m.cost}))).filter(x=>x.available).length,0,'A key and price row must not activate an unverified model');
for(const m of catalog){
 calls.length=0;
 const bytes=await imageBytes(m,'Mock prompt','1:1',{});
 assert.ok(bytes.length>0,m.id+' returned no image');
 const apiCall=calls.find(x=>x.options.method==='POST');
 assert.ok(apiCall,m.id+' did not route to an API');
 const payload=String(apiCall.options.body||'');
 const expected=m.provider==='Stability AI'?m.id==='stability_sd35'?'sd3':'ultra':m.modelId;
 assert.ok(apiCall.url.includes(expected)||payload.includes(expected),m.id+' routed to wrong model');
 assert.ok(!payload.includes('sk-proj-'),m.id+' leaked a credential');
 console.log('PASS '+m.id);
}
