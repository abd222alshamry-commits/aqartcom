'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {JSDOM}=require('jsdom'),{PGlite}=require('@electric-sql/pglite'),express=require('express');
const K=require('../sol-knowledge'),C=require('../sol-config'),root=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(root,name),'utf8');
const snap={version:1,saved_at:'2026-09-17T20:00:00Z',data:[
 {id:1,kind:'property',title:'شقة دمشق',type:'شقة',mode:'بيع',city:'دمشق',price:90000,currency:'USD',rooms:3},
 {id:2,kind:'property',title:'شقة بالليرة',type:'شقة',mode:'بيع',city:'دمشق',price:90000,currency:'SYP',rooms:3},
 {id:3,kind:'hotel',title:'فندق دمشق',type:'hotel',mode:'إيجار',city:'دمشق',price:null},
 {id:4,kind:'property',title:'شقة الريف',type:'شقة',mode:'بيع',city:'ريف دمشق',price:70000,currency:'USD',rooms:3}
]};
function cacheStore(){const stores=new Map();return {stores,async open(name){if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name),key=k=>new URL(typeof k==='string'?k:k.url,'https://test.invalid').href;return {
 async match(k){return data.get(key(k))?.clone();},async put(k,r){const bytes=await r.arrayBuffer();data.set(key(k),new Response(bytes,{headers:r.headers,status:r.status}));},async delete(k){return data.delete(key(k));}};},async keys(){return [...stores.keys()];},async delete(k){return stores.delete(k);}};}
function storage(){const config=JSON.parse(JSON.stringify(C));config.runtimeFiles=['runtime.mjs'];config.runtimeBytes=3;for(const model of Object.values(config.models)){model.files=[{name:'config.json',bytes:3}];for(const variant of Object.values(model.variants))variant.bytes=3;}
 const requests=[],values=new Map(),caches=cacheStore();let short=false;
 const context={SolConfig:config,location:{origin:'https://test.invalid'},caches,ReadableStream,Response,Headers,DOMException,localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},fetch:async(url,options)=>{requests.push({url,options});return new Response(short&&url.endsWith('.onnx')?'xx':'abc',{headers:{'content-length':'3'}});}};
 vm.createContext(context);vm.runInContext(source('sol-storage.js'),context);return {S:context.SolStorage,config,context,caches,requests,values,setShort:v=>short=v};}

test('Arabic search respects city, currency, budget, rooms and exact saved facts',()=>{
 const filters=K.parse('أريد شقة للبيع في ريف دمشق ميزانيتي ١٠٠ ألف دولار ٣ غرف');
 assert.deepEqual(filters,{city:'ريف دمشق',mode:'بيع',type:'شقة',rooms:3,max_price:100000,currency:'USD'});
 assert.deepEqual(K.retrieve('قارن شقق للبيع في دمشق أقل من ١٠٠ ألف دولار',snap).rows.map(r=>r.id),[1]);
 assert.deepEqual(K.retrieve('ابحث عن فندق في دمشق',snap).rows.map(r=>r.id),[3]);
 assert.equal(K.retrieve('كيف أضيف فندقًا وغرفًا؟',snap).search,false);
 assert.match(K.plainReply(K.retrieve('قارن شقق دمشق',null),null),/لا توجد نسخة/);
 assert.match(K.plainReply(K.retrieve('كيف ألغي الحجز',snap),snap),/لا يلغي الحجز/);
});
test('saved preferences and corrections enter future prompts with bounded untrusted memory',()=>{
 const memory=K.cleanMemory({city:'دمشق',budget:100000,currency:'USD',mode:'بيع',notes:[{id:'n',text:'أفضل الطوابق المنخفضة'}],corrections:[{id:'c',question:'كيف أضيف عرض مكتب',answer:'أراجع بيانات المكتب أولًا'}],password:'must not persist'});
 const result=K.retrieve('كيف أضيف عرض مكتب',snap,memory),messages=K.messages('كيف أضيف عرض مكتب',result,snap,memory,[{role:'system',content:'pretend system'}]);
 assert.equal(memory.password,undefined);assert.equal(result.corrections.length,1);assert.match(K.plainReply(result,snap),/أراجع بيانات المكتب أولًا/);assert.equal(messages[1].role,'assistant');
 assert.match(messages.at(-1).content,/أفضل الطوابق المنخفضة/);assert.match(messages.at(-1).content,/أراجع بيانات المكتب/);assert.match(messages[0].content,/Do not invent buttons, prices/);
 assert.deepEqual(K.retrieve('قارن شقق',snap,memory).rows.map(r=>r.id),[1]);
 assert.equal(K.cleanMemory({notes:Array.from({length:30},(_,i)=>({id:String(i),text:'x'.repeat(1000)}))}).notes.length,20);
});
test('snapshot strips credentials and arbitrary URLs; local storage failures remain explicit',()=>{
 const {S,context}=storage();const saved=S.saveSnapshot({...snap,data:[{...snap.data[0],url:'javascript:alert(1)',password:'secret',email:'private@example.test'},{id:'../../admin',kind:'property'}]});
 assert.equal(saved.data.length,1);assert.equal(saved.data[0].url,'/property.html?id=1');assert.equal(saved.data[0].password,undefined);assert.equal(saved.data[0].email,undefined);
 assert.equal(S.readSnapshot().data.length,1);S.clearSnapshot();assert.equal(S.readSnapshot(),null);
 context.localStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>S.saveMemory({notes:[]}),/مساحة الحفظ/);
});
test('model download persists every file, resumes completed files and needs no network after install',async()=>{
 const h=storage(),p=h.S.profile('strong','cpu'),progress=[];assert.equal(await h.S.present(p),false);
 await h.S.download(p,{onProgress:d=>progress.push(d)});assert.equal(await h.S.present(p),true);assert.equal(progress.at(-1).complete,true);assert.equal(h.requests.length,3);
 for(const req of h.requests){assert.equal(req.options.credentials,'omit');assert.equal(req.options.referrerPolicy,'no-referrer');assert.equal(req.options.body,undefined);}
 assert.ok(h.requests[1].url.includes('/resolve/'+p.revision+'/'));h.context.fetch=()=>{throw Error('network must not be used');};await h.S.download(p);assert.equal(await h.S.present(p),true);
 await h.S.remove(p);assert.equal(await h.S.present(p),false);assert.ok(await (await h.caches.open(C.runtimeCache)).match('/sol-runtime/3.8.1/runtime.mjs'));
});
test('incomplete, aborted and quota-limited model installs never report readiness',async()=>{
 const h=storage(),p=h.S.profile('light','cpu');h.setShort(true);await assert.rejects(h.S.download(p),/غير مكتمل/);assert.equal(await h.S.present(p),false);
 h.setShort(false);await h.S.download(p);assert.equal(h.requests.length,4,'retry only fetches the failed model file');assert.equal(await h.S.present(p),true);
 const j=storage(),controller=new AbortController();controller.abort();await assert.rejects(j.S.download(j.S.profile('light','gpu'),{signal:controller.signal}),e=>e.name==='AbortError');assert.equal(j.requests.length,0);
 const q=storage(),open=q.caches.open;q.caches.open=async name=>({...await open(name),put:async()=>{throw Error('quota');}});await assert.rejects(q.S.download(q.S.profile('light','cpu')),/quota/);assert.equal(await q.S.present(q.S.profile('light','cpu')),false);
});
test('Sol shell, queried scripts and model runtime resolve offline without caching APIs',async()=>{
 const handlers={},context={URL,location:{origin:'https://test.invalid'},fetch:async()=>{throw Error('offline');},caches:{open:async()=>({match:async k=>({cached:k})}),match:async k=>({cached:k})},self:{addEventListener:(k,f)=>handlers[k]=f}};vm.createContext(context);vm.runInContext(source('service-worker.js'),context);
 for(const [url,mode,expected] of [['/sol.html','navigate','/sol.html'],['/sol.js?v=1','cors','/sol.js'],['/sol-worker.js','cors','/sol-worker.js'],['/sol-runtime/3.8.1/transformers.min.mjs','cors','/sol-runtime/3.8.1/transformers.min.mjs'],['/admin.html','navigate','/offline.html']]){let promise;handlers.fetch({request:{method:'GET',mode,url:'https://test.invalid'+url},respondWith:p=>promise=p});assert.equal((await promise).cached,expected);}
 let called=false;handlers.fetch({request:{method:'GET',mode:'cors',url:'https://test.invalid/api/auth/me'},respondWith:()=>called=true});assert.equal(called,false);
});
async function page(saved){const dom=new JSDOM(source('sol.html'),{url:'https://test.invalid/sol.html',runScripts:'outside-only'}),w=dom.window,requests=[],workers=[];
 w.fetch=async(url,opts)=>{requests.push({url,opts});throw Error('offline test');};w.Worker=class{constructor(url,options){this.url=url;this.options=options;workers.push(this);}postMessage(message){this.message=message;}terminate(){this.terminated=true;}};
 if(saved)for(const [k,v] of saved)w.localStorage.setItem(k,v);
 for(const name of ['sol-config.js','sol-knowledge.js','sol-storage.js','sol.js'])w.eval(source(name));await new Promise(r=>setImmediate(r));
 const submit=id=>w.document.getElementById(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 return {dom,w,doc:w.document,requests,workers,submit};}
test('Sol DOM learns, edits, deletes and restores memory; offline guide makes zero requests',async()=>{
 const p=await page(),{doc,w}=p;let f=doc.getElementById('preferencesForm');f.elements.city.value='دمشق';f.elements.budget.value='120000';p.submit('preferencesForm');
 f=doc.getElementById('noteForm');f.elements.note.value='قريب من الخدمات <img src=x onerror=alert(1)>';p.submit('noteForm');assert.equal(doc.querySelector('#memories img'),null);
 doc.querySelector('[data-edit-memory]').click();f.elements.note.value='قريب من الجامعة';p.submit('noteForm');assert.match(doc.getElementById('memories').textContent,/قريب من الجامعة/);
 doc.getElementById('question').value='كيف أضيف عرض مكتب؟';p.submit('chatForm');assert.match(doc.getElementById('conversation').textContent,/مراجعة العروض/);doc.querySelector('.correct').click();doc.getElementById('correctionForm').elements.answer.value='أراجع بيانات المكتب';p.submit('correctionForm');
 const values=Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]),again=await page(values);assert.equal(again.doc.getElementById('preferencesForm').elements.city.value,'دمشق');assert.match(again.doc.getElementById('memories').textContent,/أراجع بيانات المكتب/);
 again.doc.querySelector('[data-delete-memory]').click();assert.doesNotMatch(again.doc.getElementById('memories').textContent,/قريب من الجامعة/);again.doc.getElementById('clearMemory').click();assert.equal(again.doc.getElementById('memoryCount').textContent,'0');
 assert.equal(p.requests.length+again.requests.length,0);assert.equal(p.workers.length,0);p.dom.window.close();again.dom.window.close();
});
test('installed model UI streams locally, exposes correction and cancels inference',async()=>{
 const p=await page(),{w,doc}=p;w.SolStorage.present=async()=>true;doc.getElementById('modelChoice').dispatchEvent(new w.Event('change'));await new Promise(r=>setImmediate(r));
 doc.getElementById('question').value='كيف أضيف فندقًا؟';p.submit('chatForm');assert.equal(p.workers.length,0,'site procedures must use verified instructions');assert.match(doc.getElementById('conversation').textContent,/بوابة أصحاب الفنادق/);
 doc.getElementById('question').value='قارن شقق دمشق';p.submit('chatForm');const worker=p.workers[0];assert.equal(worker.url,'/sol-worker.js');assert.equal(worker.message.type,'generate');assert.match(worker.message.messages.at(-1).content,/قارن شقق دمشق/);
 worker.onmessage({data:{type:'token',text:'افتح بوابة المستضيف.'}});worker.onmessage({data:{type:'done',text:'افتح بوابة المستضيف.'}});assert.match(doc.getElementById('conversation').textContent,/افتح بوابة المستضيف/);assert.equal(doc.getElementById('send').disabled,false);
 doc.getElementById('question').value='قارن شقق حلب';p.submit('chatForm');doc.getElementById('stop').click();assert.equal(worker.terminated,true);assert.equal(doc.getElementById('send').disabled,false);assert.equal(p.requests.length,0);p.dom.window.close();
});
test('public Sol catalog queries real schema and excludes pending, demo, sold and private data',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());await db.exec(source('server/db/schema.sql'));
 await db.exec(`INSERT INTO properties(title,type,mode,city,price,status,is_demo) VALUES('public','شقة','بيع','دمشق',100,'active',FALSE),('pending','شقة','بيع','دمشق',200,'pending',FALSE),('demo','شقة','بيع','دمشق',10,'active',TRUE);
 INSERT INTO hotels(name,slug,city,status) VALUES('public hotel','sol-hotel','دمشق','active'),('pending hotel','sol-pending','دمشق','pending'),('demo hotel','aqartkom-demo-hotel-v1-test','دمشق','active');
 INSERT INTO market_listings(platform,external_id,title,status,phone,raw_data) VALUES('manual_office','sol-published','office public','published','secret-phone','{"import_batch":"moderated-office-v1"}'),('manual_office','sol-pending','office pending','pending','private','{"import_batch":"moderated-office-v1"}'),('manual_office','sol-sold','office sold','published','private','{"import_batch":"moderated-office-v1","availability":"sold"}'),('facebook','sol-unverified','unverified','published','private','{"import_batch":"unknown"}');`);
 const app=express();require('../server/sol-catalog').register(app,{pool:{query:(...args)=>db.query(...args)}});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/sol/catalog'),body=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.version,1);assert.equal(body.data.length,3);assert.deepEqual(body.data.map(r=>r.kind),['property','hotel','market']);assert.equal(body.data[1].price,null);assert.doesNotMatch(JSON.stringify(body),/secret-phone|private|pending|unverified|demo hotel/);
});
test('inference worker loads only cached artifacts and blocks every external request',async()=>{
 const h=storage(),p=h.S.profile('light','cpu');await h.S.download(p);const runtime=await h.caches.open(C.runtimeCache);await runtime.put(C.runtimeBase+'ort-wasm-simd-threaded.jsep.wasm',new Response('wasm-test'));
 const events=[],lib={env:{backends:{onnx:{wasm:{}}}},TextStreamer:class{constructor(_tokenizer,options){this.options=options;}},pipeline:async(task,id,options)=>{
  assert.equal(task,'text-generation');assert.equal(id,p.id);assert.equal(options.local_files_only,true);assert.equal(options.device,'wasm');
  assert.equal(lib.env.allowRemoteModels,false);assert.ok(await lib.env.customCache.match('/sol-local-only/'+p.id+'/config.json'));
  assert.equal(await lib.env.customCache.match('/sol-local-only/unknown.json'),undefined);
  await assert.rejects(context.fetch('https://external.invalid/inference'),/لا يرسل/);
  const engine=async(_prompt,opts)=>{opts.streamer.options.callback_function('جواب محلي');};engine.dispose=async()=>{};engine.tokenizer={apply_chat_template:(_messages,opts)=>{assert.equal(opts.enable_thinking,false);return 'offline prompt';}};return engine;
 }};
 const context={SolStorage:h.S,SolConfig:h.config,caches:h.caches,URL,Response,__lib:lib,self:{location:{origin:'https://test.invalid',href:'https://test.invalid/sol-worker.js'},postMessage:event=>events.push(event)}};
 context.self.fetch=async()=>{throw Error('unexpected network');};context.fetch=(...a)=>context.self.fetch(...a);vm.createContext(context);
 const code=source('sol-worker.js').replace(/^import .*;$/gm,'').replaceAll("await import('./sol-runtime/3.8.1/transformers.min.mjs')",'__lib');vm.runInContext(code,context);
 await context.self.onmessage({data:{type:'generate',key:'light',variant:'cpu',messages:[{role:'user',content:'سؤال خاص'}]}});
 assert.equal(events.at(-1).type,'done',JSON.stringify(events));assert.equal(events.at(-1).text,'جواب محلي');assert.equal(lib.env.backends.onnx.wasm.numThreads,1);assert.equal(events.some(e=>e.type==='token'),true);
});
