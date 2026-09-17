(function(root){
'use strict';
const config=root.SolConfig||(typeof require==='function'?require('./sol-config'):null);
const origin=()=>root.location?.origin||'https://aqartkom.local';
function profile(key,variant){const m=config.models[key];if(!m||!m.variants[variant])throw Error('نموذج غير معروف');return {...m,key,variant,...m.variants[variant]};}
function files(p){return [...p.files,{name:p.file,bytes:p.bytes}].map(f=>({...f,url:'https://huggingface.co/'+p.id+'/resolve/'+p.revision+'/'+f.name}));}
function modelKey(p,f){return origin()+'/sol-model-cache/'+p.key+'/'+p.variant+'/'+p.revision+'/'+f.name;}
async function present(p){
 if(!root.caches)return false;
 try{const model=await caches.open(config.modelCache),runtime=await caches.open(config.runtimeCache);
  for(const f of files(p)){const r=await model.match(modelKey(p,f));if(!r||r.headers.get('x-sol-bytes')!==String(f.bytes))return false;}
  for(const file of config.runtimeFiles)if(!await runtime.match(config.runtimeBase+file))return false;
  return true;
 }catch{return false;}
}
async function download(p,{signal,onProgress=()=>{}}={}){
 if(!root.caches||!root.ReadableStream)throw Error('هذا المتصفح لا يدعم حفظ النموذج محليًا. استخدم متصفحًا حديثًا.');
 const model=await caches.open(config.modelCache),runtime=await caches.open(config.runtimeCache);
 const list=[...config.runtimeFiles.map(name=>({name,url:config.runtimeBase+name,bytes:0,cache:runtime,key:config.runtimeBase+name})),
  ...files(p).map(f=>({...f,cache:model,key:modelKey(p,f)}))];
 const total=files(p).reduce((n,f)=>n+f.bytes,0)+config.runtimeBytes;let loaded=0;
 for(const f of list){
  if(signal?.aborted)throw new DOMException('تم إيقاف التنزيل','AbortError');
  const existing=await f.cache.match(f.key);
  if(existing&&(!f.bytes||existing.headers.get('x-sol-bytes')===String(f.bytes))){loaded+=f.bytes||Number(existing.headers.get('x-sol-bytes'))||0;onProgress({loaded,total,file:f.name});continue;}
  // Fixed public artifact URLs only. Prompts and personal memory never enter these requests.
  const response=await fetch(f.url,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok||!response.body)throw Error('تعذر تنزيل ملف من النموذج. تحقق من الاتصال ثم أعد المحاولة.');
  let bytes=0;const reader=response.body.getReader();
  const stream=new ReadableStream({async pull(controller){try{const item=await reader.read();if(item.done){if(f.bytes&&bytes!==f.bytes)throw Error('التنزيل غير مكتمل؛ أعد المحاولة');controller.close();return;}bytes+=item.value.byteLength;onProgress({loaded:loaded+bytes,total,file:f.name});controller.enqueue(item.value);}catch(e){controller.error(e);await reader.cancel().catch(()=>{});}},cancel(){return reader.cancel();}});
  const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');headers.set('x-sol-bytes',String(f.bytes||response.headers.get('content-length')||0));
  try{await f.cache.put(f.key,new Response(stream,{status:200,headers}));}catch(e){await f.cache.delete(f.key);throw e;}
  loaded+=bytes;onProgress({loaded,total,file:f.name});
 }
 if(!await present(p))throw Error('لم يكتمل حفظ النموذج للعمل دون اتصال');
 onProgress({loaded:total,total,complete:true});
}
async function remove(p){if(!root.caches)return;const cache=await caches.open(config.modelCache);for(const f of files(p))await cache.delete(modelKey(p,f));}
const snapshotKey='aqartkom-sol-public-snapshot-v1',memoryKey='aqartkom-sol-memory-v1';
function read(key,fallback){try{return JSON.parse(root.localStorage.getItem(key))||fallback;}catch{return fallback;}}
function write(key,value){try{root.localStorage.setItem(key,JSON.stringify(value));}catch{throw Error('مساحة الحفظ غير كافية أو ممنوعة في المتصفح. لن تبقى هذه البيانات بعد إغلاق الصفحة.');}}
function sanitizeSnapshot(data){
 if(data?.version!==1||!Number.isFinite(Date.parse(data.saved_at))||!Array.isArray(data.data))throw Error('نسخة العروض غير صالحة');
 const rows=data.data.slice(0,600).filter(r=>r&&['property','hotel','market'].includes(r.kind)&&/^\d+$/.test(String(r.id))).map(r=>{
  const item={};for(const key of ['id','kind','key','title','type','mode','city','district','price','currency','area','rooms','description','office_name','rental_terms','cancellation_policy','star_rating']){
   const v=r[key];if(typeof v==='string')item[key]=v.slice(0,key==='rental_terms'||key==='cancellation_policy'?1000:500);else if(v==null||typeof v==='number')item[key]=v;
  }
  item.url=r.kind==='property'?'/property.html?id='+r.id:r.kind==='market'?'/office-property.html?id='+r.id:'/hotels.html';return item;
 });
 return {version:1,saved_at:data.saved_at,data:rows,note:String(data.note||'').slice(0,400)};
}
const api={profile,files,modelKey,present,download,remove,sanitizeSnapshot,
 readSnapshot:()=>{try{const data=read(snapshotKey,null);return data?sanitizeSnapshot(data):null;}catch{return null;}},
 saveSnapshot:data=>{const safe=sanitizeSnapshot(data);write(snapshotKey,safe);return safe;},
 readMemory:()=>read(memoryKey,{}),saveMemory:value=>write(memoryKey,value),
 clearMemory:()=>root.localStorage.removeItem(memoryKey),clearSnapshot:()=>root.localStorage.removeItem(snapshotKey)};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SolStorage=api;
})(typeof globalThis!=='undefined'?globalThis:this);
