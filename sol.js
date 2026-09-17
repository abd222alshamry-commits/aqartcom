(() => {
'use strict';
const $=id=>document.getElementById(id),K=SolKnowledge,S=SolStorage,C=SolConfig;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let memory=K.cleanMemory(S.readMemory()),snapshot=S.readSnapshot(),variant='cpu',worker=null,ready=false,busy=false,installed=false,downloading=null,history=[],pending=null,workerSerial=0,modelCheck=0;
const humanBytes=n=>(n/1e9).toLocaleString('ar-SY',{maximumFractionDigits:2})+' غيغابايت';
const selected=()=>S.profile($('modelChoice').value,variant);
function announce(id,text){$(id).textContent=text;}
function connection(){announce('connection',navigator.onLine===false?'دون إنترنت':'متصل');$('syncCatalog').disabled=navigator.onLine===false;}
function snapshotStatus(){announce('snapshotStatus',snapshot?snapshot.data.length+' عرضًا محفوظًا · آخر تحديث: '+new Date(snapshot.saved_at).toLocaleString('ar-SY'):'لا توجد نسخة محفوظة بعد.');$('clearCatalog').hidden=!snapshot;}
function setBusy(value){busy=value;$('send').disabled=value;$('stop').hidden=!value;$('modelChoice').disabled=value||!!downloading;$('clearChat').disabled=value;$('removeModel').disabled=value||!!downloading;}
function bubble(text,role='assistant',label='سول'){
 const article=document.createElement('article');article.className='bubble '+role;const name=document.createElement('b');name.textContent=role==='user'?'أنت':label;
 const body=document.createElement('p');body.textContent=text;article.append(name,body);$('conversation').append(article);$('conversation').scrollTop=$('conversation').scrollHeight;return {article,body};
}
function correctionButton(article,question,answer){const b=document.createElement('button');b.type='button';b.className='correct';b.textContent='صحّح هذه الإجابة ليتذكرها سول';b.onclick=()=>{const f=$('correctionForm');delete f.dataset.editing;f.hidden=false;f.dataset.question=question;f.elements.answer.value=answer.slice(0,1000);announce('correctionQuestion',question);f.elements.answer.focus();};article.append(b);}
function results(result){
 const date=snapshot?.saved_at?new Date(snapshot.saved_at).toLocaleString('ar-SY'):'';
 $('results').innerHTML=result.rows.length?`<table><caption>مقارنة من النسخة المحفوظة ${esc(date)}؛ السعر والتوفر غير مؤكدين الآن.</caption><thead><tr><th>العرض</th><th>السعر</th><th>المساحة</th><th>الغرف</th></tr></thead><tbody>${result.rows.map(r=>`<tr><td><a href="${esc(r.url)}">${esc(r.title)}</a><br>${esc(r.city)} · ${esc(r.office_name||'')}</td><td>${r.price!=null?esc(Number(r.price).toLocaleString('ar-SY')+' '+r.currency):'يُراجع في العرض'}</td><td>${r.area!=null?esc(r.area)+' م²':'غير مذكورة'}</td><td>${esc(r.rooms??'غير مذكورة')}</td></tr>`).join('')}</tbody></table>`:`<div class="source-links">${result.guides.map(g=>`<details class="guide"><summary>${esc(g.title)} — دليل الموقع</summary><p>${esc(g.text)}</p>${g.url?`<a href="${esc(g.url)}">فتح الصفحة</a>`:''}</details>`).join('')}</div>`;
}
function terminate(){workerSerial++;worker?.terminate();worker=null;ready=false;setBusy(false);}
function startWorker(){
 if(worker)return worker;if(!window.Worker)throw Error('المتصفح لا يدعم تشغيل النموذج. يبقى دليل الموقع والبحث المحلي متاحين.');
 const serial=++workerSerial;worker=new Worker('/sol-worker.js',{type:'module'});
 worker.onmessage=event=>{if(serial!==workerSerial)return;const d=event.data;
  if(d.type==='status')announce('chatStatus',d.text);
  if(d.type==='ready'){ready=true;announce('modelStatus','النموذج جاهز ويعمل على جهازك');announce('modeLabel','محادثة ذكية محلية — '+selected().label);if(!pending){setBusy(false);announce('chatStatus','سول جاهز دون إنترنت');}}
  if(d.type==='token'&&pending){pending.body.textContent+=d.text;$('conversation').scrollTop=$('conversation').scrollHeight;}
  if(d.type==='done'&&pending){const p=pending;p.body.textContent=d.text||'لم تكتمل الإجابة؛ حاول صياغة السؤال بصورة أقصر.';history.push({role:'user',content:p.question},{role:'assistant',content:p.body.textContent});history=history.slice(-8);correctionButton(p.article,p.question,p.body.textContent);pending=null;setBusy(false);announce('chatStatus','تمت الإجابة محليًا على جهازك.');}
  if(d.type==='error'){const message=d.message;if(pending){pending.body.textContent='تعذرت الإجابة بالنموذج. '+K.plainReply(pending.result,snapshot);pending=null;}terminate();announce('modelStatus',message);announce('chatStatus','يمكنك متابعة دليل الموقع والبحث المحلي.');announce('modeLabel','دليل الموقع والبحث المحلي — النموذج غير جاهز');}
 };
 worker.onerror=()=>{if(serial!==workerSerial)return;if(pending){pending.body.textContent='تعذر تشغيل النموذج. '+K.plainReply(pending.result,snapshot);pending=null;}terminate();announce('modelStatus','تعذر فتح ملفات التشغيل. أعد محاولة التنزيل أثناء الاتصال أو اختر النموذج الأخف.');};
 return worker;
}
async function inspectModel(){const token=++modelCheck,p=selected();ready=false;announce('modelSize','التنزيل الأول نحو '+humanBytes(S.files(p).reduce((n,f)=>n+f.bytes,0)+C.runtimeBytes)+(variant==='gpu'?' · تسريع الجهاز متاح':' · تشغيل على المعالج؛ قد يكون أبطأ'));const found=await S.present(p);if(token!==modelCheck)return;installed=found;$('downloadModel').textContent=installed?'تشغيل النموذج المحفوظ':'تنزيل وتشغيل النموذج';$('removeModel').hidden=!installed;announce('modelStatus',installed?'ملفات النموذج محفوظة. يمكنك تشغيله دون إنترنت.':'النموذج لم يُنزّل بعد. دليل الموقع يعمل دون تنزيل النموذج.');}
async function ensureShell(){
 if(!('serviceWorker' in navigator)){announce('offlinePage','الحفظ غير مدعوم');return;}
 try{
  const check=async()=>{const cache=await caches.open('aqartkom-v93-sol-shell-v1');const files=['/sol.html','/sol.css','/sol.js','/sol-config.js','/sol-knowledge.js','/sol-storage.js','/sol-worker.js'];const saved=await Promise.all(files.map(f=>cache.match(f)));announce('offlinePage',saved.every(Boolean)?'الصفحة محفوظة':'جارٍ حفظ الصفحة');};
  const registration=await navigator.serviceWorker.register('/service-worker.js');
  const observe=()=>{const sw=registration.installing;if(sw)sw.addEventListener('statechange',()=>{if(sw.state==='activated')check().catch(()=>{});});};
  observe();registration.addEventListener('updatefound',observe);navigator.serviceWorker.addEventListener('controllerchange',()=>check().catch(()=>{}));
  await navigator.serviceWorker.ready;await check();
 }
 catch{announce('offlinePage','تعذر حفظ الصفحة');}
}
$('downloadModel').onclick=async()=>{
 if(busy||downloading)return;const p=selected();$('downloadModel').disabled=true;$('modelChoice').disabled=true;
 try{
  if(!await S.present(p)){
   if(navigator.onLine===false)throw Error('يلزم اتصال لأول تنزيل فقط.');
   const estimate=await navigator.storage?.estimate?.();const bytes=S.files(p).reduce((n,f)=>n+f.bytes,0)+C.runtimeBytes;
   if(estimate?.quota&&estimate.quota-(estimate.usage||0)<bytes*1.15)throw Error('لا توجد مساحة كافية. اختر النموذج الأخف أو حرر مساحة على الجهاز.');
   await navigator.storage?.persist?.().catch(()=>false);downloading=new AbortController();$('cancelDownload').hidden=false;$('downloadProgress').hidden=false;
   await S.download(p,{signal:downloading.signal,onProgress:d=>{$('downloadProgress').value=Math.min(100,d.loaded/d.total*100);announce('modelStatus',d.complete?'تم حفظ جميع الملفات. جارٍ التشغيل…':'تنزيل '+humanBytes(d.loaded)+' من نحو '+humanBytes(d.total));}});
  }
  installed=true;$('removeModel').hidden=false;$('downloadModel').textContent='تشغيل النموذج المحفوظ';setBusy(true);startWorker().postMessage({type:'load',key:p.key,variant:p.variant});
 }catch(e){announce('modelStatus',e.name==='AbortError'?'تم إيقاف التنزيل. يمكنك إعادة المحاولة لاحقًا.':e.message);setBusy(false);}
 finally{downloading=null;$('cancelDownload').hidden=true;$('downloadModel').disabled=false;$('modelChoice').disabled=busy;}
};
$('cancelDownload').onclick=()=>downloading?.abort();
$('removeModel').onclick=async()=>{if(downloading||busy)return;pending=null;terminate();try{await S.remove(selected());await inspectModel();announce('modeLabel','دليل الموقع والبحث المحلي');}catch(e){announce('modelStatus',e.message);}};
$('modelChoice').onchange=async()=>{terminate();pending=null;await inspectModel();};
$('stop').onclick=()=>{if(pending){pending.body.textContent+='\nتم إيقاف الإجابة.';pending=null;}terminate();announce('chatStatus','تم الإيقاف وتحرير النموذج من الذاكرة.');};
$('clearChat').onclick=()=>{history=[];$('conversation').replaceChildren();$('results').replaceChildren();$('correctionForm').hidden=true;bubble('بدأنا محادثة جديدة. تفضيلاتك وتصحيحاتك المحفوظة ما زالت في ذاكرة سول.');};
$('chatForm').onsubmit=async event=>{
 event.preventDefault();if(busy||downloading)return;const question=$('question').value.trim();if(!question)return;$('question').value='';bubble(question,'user');const result=K.retrieve(question,snapshot,memory);results(result);
 if(/^تذكر\s/.test(question)){const note=question.replace(/^تذكر\s+(?:أنني\s+|اني\s+)?/,'').slice(0,500);$('noteForm').elements.note.value=note;$('memoryPanel').open=true;bubble('جهزت هذه المعلومة في خانة الذاكرة. اضغط «إضافة إلى الذاكرة» إذا أردت حفظها على هذا الجهاز.','assistant','سول — الذاكرة');return;}
 const siteProcedure=!result.search&&result.guides.some(g=>['host','office','team','payment','cancel','publish','offline','memory','hotels'].includes(g.id));
 if(!installed||siteProcedure){const reply=K.plainReply(result,snapshot),b=bubble(reply,'assistant',siteProcedure?'سول — من دليل الموقع':'سول — دليل وبحث محلي');correctionButton(b.article,question,reply);announce('chatStatus',siteProcedure?'هذه الخطوات من دليل الموقع مباشرة.':'للمحادثة التوليدية، نزّل النموذج من لوحة «سول دون إنترنت».');return;}
 const b=bubble('','assistant','سول — ذكاء محلي');pending={...b,question,result};setBusy(true);
 try{startWorker().postMessage({type:'generate',key:selected().key,variant,messages:K.messages(question,result,snapshot,memory,history)});}catch(e){pending.body.textContent=e.message;pending=null;setBusy(false);}
};
$('question').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!busy)$('chatForm').requestSubmit();}};
document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('question').value=b.dataset.prompt;$('question').focus();$('chatForm').requestSubmit();});
$('syncCatalog').onclick=async()=>{const b=$('syncCatalog');b.disabled=true;announce('snapshotStatus','جارٍ تحديث العروض العامة…');try{const r=await fetch('/api/sol/catalog',{credentials:'omit',cache:'no-store'});if(!r.ok)throw Error('تعذر الاتصال بالموقع؛ بقيت نسختك المحفوظة كما هي.');snapshot=S.saveSnapshot(await r.json());snapshotStatus();}catch(e){snapshotStatus();announce('snapshotStatus',$('snapshotStatus').textContent+' '+e.message);}finally{connection();}};
$('clearCatalog').onclick=()=>{S.clearSnapshot();snapshot=null;$('results').replaceChildren();snapshotStatus();};
function renderMemory(){const f=$('preferencesForm');for(const n of ['city','budget','currency','mode'])f.elements[n].value=memory[n]??'';announce('memoryCount',memory.notes.length+memory.corrections.length);
 $('memories').innerHTML=[...memory.notes.map(n=>({id:n.id,text:n.text,type:'note'})),...memory.corrections.map(c=>({id:c.id,text:c.question+'\nالتصحيح: '+c.answer,type:'correction'}))].map(n=>`<div class="memory"><p>${esc(n.text)}</p><button class="quiet" data-edit-memory="${esc(n.id)}" data-type="${n.type}">تعديل</button> <button class="quiet" data-delete-memory="${esc(n.id)}" data-type="${n.type}">حذف</button></div>`).join('');
 $('memories').querySelectorAll('[data-delete-memory]').forEach(b=>b.onclick=()=>{const field=b.dataset.type==='note'?'notes':'corrections';saveMemory({...memory,[field]:memory[field].filter(n=>n.id!==b.dataset.deleteMemory)});});
 $('memories').querySelectorAll('[data-edit-memory]').forEach(b=>b.onclick=()=>{const isNote=b.dataset.type==='note',n=memory[isNote?'notes':'corrections'].find(n=>n.id===b.dataset.editMemory),f=$(isNote?'noteForm':'correctionForm');f.dataset.editing=n.id;if(isNote)f.elements.note.value=n.text;else{f.hidden=false;f.dataset.question=n.question;announce('correctionQuestion',n.question);f.elements.answer.value=n.answer;}f.querySelector('textarea').focus();});
}
function saveMemory(next){try{const clean=K.cleanMemory(next);S.saveMemory(clean);memory=clean;renderMemory();announce('memoryStatus','تم حفظ الذاكرة على هذا الجهاز.');return true;}catch(e){announce('memoryStatus',e.message);return false;}}
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
$('preferencesForm').onsubmit=e=>{e.preventDefault();saveMemory({...memory,...Object.fromEntries(new FormData(e.currentTarget))});};
$('noteForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,note=f.elements.note.value.trim();if(!note)return;const id=f.dataset.editing||uid();if(saveMemory({...memory,notes:[...memory.notes.filter(n=>n.id!==id),{id,text:note}]})){f.reset();delete f.dataset.editing;}};
$('correctionForm').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,id=f.dataset.editing||uid(),answer=f.elements.answer.value.trim();if(!answer)return;if(saveMemory({...memory,corrections:[...memory.corrections.filter(c=>c.id!==id),{id,question:f.dataset.question,answer}]})){f.hidden=true;f.reset();delete f.dataset.editing;announce('chatStatus','حُفظ تصحيحك. سيستخدمه سول عند الأسئلة المشابهة على هذا الجهاز.');}};
$('cancelCorrection').onclick=()=>{$('correctionForm').hidden=true;delete $('correctionForm').dataset.editing;};
$('clearMemory').onclick=()=>{try{S.clearMemory();memory=K.cleanMemory();renderMemory();$('noteForm').reset();delete $('noteForm').dataset.editing;delete $('correctionForm').dataset.editing;$('correctionForm').reset();$('correctionForm').hidden=true;announce('memoryStatus','تم مسح التفضيلات والملاحظات والتصحيحات.');}catch(e){announce('memoryStatus',e.message);}};
for(const city of K.cities){const option=document.createElement('option');option.value=city;option.textContent=city;$('memoryCity').append(option);}
window.addEventListener('online',connection);window.addEventListener('offline',connection);window.addEventListener('pagehide',()=>worker?.terminate());
connection();snapshotStatus();renderMemory();ensureShell();
(async()=>{try{const adapter=await navigator.gpu?.requestAdapter?.();if(adapter?.features.has('shader-f16'))variant='gpu';}catch{}await inspectModel();})();
})();
