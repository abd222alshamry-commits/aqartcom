import './sol-config.js';
import './sol-storage.js';
let pipeline=null,engine=null,active=null,busy=false;
const send=(type,extra={})=>self.postMessage({type,...extra});
async function load(key,variant){
 const p=SolStorage.profile(key,variant);if(!await SolStorage.present(p))throw Error('ملفات النموذج غير مكتملة. نزّل النموذج أثناء الاتصال أولًا.');
 if(active===key+':'+variant&&engine)return;
 if(engine){await engine.dispose();engine=null;}
 send('status',{text:'جارٍ فتح النموذج المحفوظ على جهازك…'});
 const lib=await import('./sol-runtime/3.8.1/transformers.min.mjs');pipeline=lib.pipeline;
 const {env}=lib;env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath='/sol-local-only/';env.useBrowserCache=false;env.useFSCache=false;env.useCustomCache=true;
 const modelCache=await caches.open(SolConfig.modelCache),known=SolStorage.files(p);
 env.customCache={match:async key=>{const file=known.find(f=>String(key).endsWith('/'+f.name));return file?modelCache.match(SolStorage.modelKey(p,file)):undefined;},put:async()=>{throw Error('Sol inference cannot download files');}};
 const runtimeCache=await caches.open(SolConfig.runtimeCache),wasm=await runtimeCache.match(SolConfig.runtimeBase+'ort-wasm-simd-threaded.jsep.wasm');
 env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
 env.backends.onnx.wasm.wasmPaths=new URL(SolConfig.runtimeBase,self.location.href).href;
 env.backends.onnx.wasm.wasmBinary=await wasm.arrayBuffer();
 // Inference is offline-only, even when the device has internet access.
 self.fetch=async input=>{
  const url=new URL(typeof input==='string'?input:input.url,self.location.href);
  if(url.origin===self.location.origin&&url.pathname.startsWith(SolConfig.runtimeBase)){const saved=await runtimeCache.match(url.href);if(saved)return saved;}
  if(url.origin===self.location.origin&&url.pathname.startsWith('/sol-local-only/'))return new Response('',{status:404});
  throw Error('سول لا يرسل المحادثات ولا يجلب ملفات أثناء الاستدلال');
 };
 engine=await pipeline('text-generation',p.id,{device:variant==='gpu'?'webgpu':'wasm',dtype:p.dtype,revision:p.revision,local_files_only:true});
 active=key+':'+variant;send('ready');
}
self.onmessage=async event=>{
 const {type,key,variant,messages}=event.data||{};if(busy){send('error',{message:'انتظر حتى تنتهي العملية الحالية'});return;}busy=true;
 try{
  if(type==='load'){await load(key,variant);return;}
  if(type!=='generate'||!Array.isArray(messages)||messages.length>8)throw Error('طلب غير صحيح');
  await load(key,variant);send('status',{text:'سول يفكّر محليًا على جهازك…'});
  const lib=await import('./sol-runtime/3.8.1/transformers.min.mjs');
  const prompt=engine.tokenizer.apply_chat_template(messages,{tokenize:false,add_generation_prompt:true,enable_thinking:false});
  let output='';const streamer=new lib.TextStreamer(engine.tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:text=>{output+=text;send('token',{text});}});
  await engine(prompt,{max_new_tokens:256,do_sample:true,temperature:0.7,top_p:0.8,top_k:20,repetition_penalty:1.12,return_full_text:false,streamer});
  send('done',{text:output.replace(/<think>[\s\S]*?<\/think>/g,'').replace(/<\/?think>/g,'').trim()});
 }catch(e){send('error',{message:'تعذر تشغيل النموذج على هذا الجهاز. جرّب النموذج الأخف أو أغلق التطبيقات الأخرى. '+String(e.message||'').slice(0,250)});}
 finally{busy=false;}
};
