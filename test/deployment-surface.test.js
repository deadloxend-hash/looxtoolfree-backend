import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('Vercel serves an isolated public directory and preserves authenticated API and worker rewrite routes',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));assert.equal(config.outputDirectory,'public');
 assert.ok(config.rewrites.some(r=>r.destination.startsWith('/api/local-worker?')));
 const root=new URL('../public/',import.meta.url),walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
 const files=walk(fileURLToPath(root));assert.ok(files.length);for(const f of files)assert.ok(!/\.(?:js|json|sql|log|py|env|map|md)$/.test(f),'Engineering source in public output: '+f);
 assert.equal(fs.existsSync(new URL('../api/loox.js',import.meta.url)),true);
 const global=config.headers.find(h=>h.source==='/(.*)').headers;for(const key of ['X-Content-Type-Options','Strict-Transport-Security','Content-Security-Policy','Permissions-Policy'])assert.ok(global.some(h=>h.key===key));
});
