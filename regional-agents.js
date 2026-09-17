(async function(){
'use strict';
const el=id=>document.getElementById(id), api='/api/admin/regional-agents';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number(value||0).toLocaleString('ar-SY');
const platforms={facebook:'فيسبوك',instagram:'إنستغرام',tiktok:'تيك توك'};
const states={pending:'بانتظار التنفيذ',running:'قيد البحث',completed:'اكتمل البحث',empty:'اكتمل بلا نتائج موثقة',error:'تعذر البحث',interrupted:'انقطع التشغيل'};
let state=null,busy=false,dirty=false,authorized=false,targetPage=1,targetPages=1,targetBusy=false,targetSerial=0,loadSerial=0;
function date(value){const d=new Date(value);return value&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ar-SY',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Damascus'}).format(d):'—';}
function signedOut(){authorized=false;el('manager').hidden=true;el('pageStatus').hidden=false;el('pageStatus').textContent='هذه الصفحة لمدير الموقع. سجّل الدخول بحساب المدير أولًا.';el('signIn').hidden=false;}
async function request(url,options={}){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  const result=await response.json().catch(()=>({}));
  if(!response.ok){if(response.status===401||response.status===403)signedOut();throw Error(result.error||'تعذر الاتصال بالموقع. حاول مرة أخرى.');}
  return result;
}
function count(name){return (state?.stats||[]).filter(row=>row.state===name).reduce((sum,row)=>sum+Number(row.count||0),0);}
function controls(){
  if(!state)return;
  const enabled=Boolean(state.settings.enabled),ready=Boolean(state.configured&&state.verified);
  el('verifyConnection').disabled=busy||!state.configured;
  el('toggleSchedule').disabled=busy||(!enabled&&!ready);
  el('toggleSchedule').textContent=enabled?'إيقاف الجدول':'تفعيل الجدول';
  el('settingsFields').disabled=busy;
  el('refreshStatus').disabled=busy;
  const pending=count('pending')+count('running'),dailyLimit=Number(state.calls_today)>=Number(state.settings.calls_per_day);
  el('runNow').disabled=busy||!enabled||!ready||pending>0||dailyLimit;
  el('runHint').textContent=!ready?'اختبر اتصال Astra بنجاح قبل تشغيل البحث.':!enabled?'فعّل الجدول لبدء البحث المجدول أو اليدوي.':dailyLimit?'اكتمل حد البحث اليومي؛ تُستكمل المهام بعد بدء اليوم التالي بتوقيت سوريا.':pending>0?'هناك '+number(pending)+' مهمة قيد التنفيذ أو الانتظار.':'تستخدم الجولة اليدوية حدود الجولة واليوم نفسها.';
}
function render(){
  const s=state.settings,c=state.catalog;
  el('governorateCount').textContent=number(c.governorates);el('localityCount').textContent=number(c.localities);
  el('publishedCount').textContent=number(state.stats.reduce((sum,row)=>sum+Number(row.published||0),0));
  el('reviewCount').textContent=number(state.stats.reduce((sum,row)=>sum+Number(row.review||0),0));
  el('modelName').textContent=state.model;
  el('keyState').textContent=state.configured?'مضبوط':'غير مضبوط';el('keyState').className=state.configured?'state-on':'state-off';
  el('verifyState').textContent=state.verified?'تم التحقق':'لم يُتحقق منه';el('verifyState').className=state.verified?'state-on':'state-off';
  el('scheduleState').textContent=s.enabled?'مفعّل':'متوقف';el('scheduleState').className=s.enabled?'state-on':'state-off';
  el('setupNote').hidden=state.configured;el('pauseReason').hidden=!s.pause_reason;el('pauseReason').textContent=s.pause_reason||'';
  el('verifiedAt').textContent=state.verified&&s.verified_at?'آخر اختبار ناجح: '+date(s.verified_at)+' بتوقيت سوريا.':'';
  el('activationNote').textContent=state.verified?'تم التحقق من الوصول إلى Astra. يعرض السجل أدناه نتائج البحث الفعلية وأخطاءه.':'يتطلب تفعيل الجدول مفتاحًا مضبوطًا واختبار اتصال ناجحًا.';
  el('nextRun').textContent=(s.enabled?'الموعد المجدول التالي: ':'أقرب موعد متاح بعد التفعيل: ')+date(state.next_run)+' بتوقيت سوريا.';
  if(!dirty){el('callsPerCycle').value=s.calls_per_cycle;el('callsPerDay').value=s.calls_per_day;el('autoPublish').checked=Boolean(s.auto_publish);}
  el('dailyUsage').textContent='طلبات اليوم: '+number(state.calls_today)+' من '+number(s.calls_per_day);
  el('catalogNote').textContent=c.coverageNote;
  el('coverageGrid').innerHTML=c.byGovernorate.map(g=>{
    const coverage=state.coverage.find(row=>row.governorate_id===g.id),searched=Number(coverage?.searched||0),total=Number(g.targets)*state.platforms.length;
    return `<article class="coverage-card"><h3>${esc(g.name)}</h3><p>${number(g.localities)} موقعًا، إضافة إلى البحث العام في المحافظة</p><progress max="${total}" value="${Math.min(searched,total)}" aria-label="${esc('تغطية '+g.name)}"></progress><p class="coverage-count">${number(searched)} من ${number(total)} بحثًا مختلفًا للمواقع والمنصات</p><p>${coverage?.last_searched?'آخر بحث: '+esc(date(coverage.last_searched)):'لم يكتمل بحث لهذه المحافظة بعد'}</p></article>`;
  }).join('');
  if(el('targetGovernorate').options.length===1)c.byGovernorate.forEach(g=>el('targetGovernorate').add(new Option(g.name,g.id)));
  el('runHistory').innerHTML=state.runs.length?state.runs.map(run=>`<article class="history-item"><div class="history-heading"><strong>${String(run.slot).startsWith('manual-')?'جولة يدوية':'جولة مجدولة'} · ${esc(date(run.scheduled_at))}</strong><span>${run.skipped_reason?'لم تبدأ جولة جديدة':run.finished_at?'اكتملت':Number(run.pending)>0?'قيد التنفيذ أو الانتظار':'بانتظار تحديث الحالة'}</span></div><p>${number(run.planned_count)} مهمة · ${number(run.pending)} متبقية</p>${run.skipped_reason?`<p>${esc(run.skipped_reason)}</p>`:''}</article>`).join(''):'<p class="empty-state">لم تبدأ أي جولة بعد.</p>';
  el('jobHistory').innerHTML=state.jobs.length?state.jobs.map(job=>`<article class="history-item"><div class="history-heading"><strong>${esc(job.target_name)} · ${esc(platforms[job.platform]||job.platform)}</strong><span>${esc(states[job.state]||job.state)}</span></div><p>${job.started_at?esc(date(job.started_at))+' · ':''}${number(job.published_count)} نُشر · ${number(job.review_count)} للمراجعة · ${number(job.duplicate_count)} مكرر</p>${job.error_message?`<p class="error-detail">${esc(job.error_message)}</p>`:''}</article>`).join(''):'<p class="empty-state">لا توجد عمليات بحث مسجلة بعد. لا يعني ذلك عدم وجود عروض عقارية.</p>';
  el('lastUpdated').textContent='آخر تحديث: '+date(new Date().toISOString())+' بتوقيت سوريا.';
  controls();
}
async function load(){const serial=++loadSerial,next=await request(api);if(serial!==loadSerial)return;state=next;render();}
async function action(message,operation,success){
  if(busy||!authorized)return;
  busy=true;controls();el('actionError').hidden=true;el('actionStatus').textContent=message;
  try{await operation();await load();el('actionStatus').textContent=success;}
  catch(error){el('actionStatus').textContent='';el('actionError').textContent=error.message;el('actionError').hidden=false;}
  finally{busy=false;controls();}
}
async function targets(page=1){
  if(!authorized)return;
  const serial=++targetSerial;targetBusy=true;el('searchTargets').disabled=true;el('previousTargets').disabled=true;el('nextTargets').disabled=true;el('targetStatus').textContent='جاري تحميل المناطق…';
  const params=new URLSearchParams({q:el('targetQuery').value.trim(),governorate:el('targetGovernorate').value,page:String(page)});
  try{
    const result=await request(api+'/targets?'+params);
    if(serial!==targetSerial)return;
    targetPage=result.page;targetPages=Math.max(1,Math.ceil(result.total/30));
    el('targetStatus').textContent=result.total?number(result.total)+' منطقة مطابقة.':'لا توجد مناطق مطابقة في الكتالوج.';
    el('targetList').innerHTML=result.data.map(target=>`<li><strong>${esc(target.name)}</strong><span>${esc(target.governorateName)} · ${target.kind==='governorate'?'بحث عام في المحافظة':'موقع ضمن المحافظة'}</span></li>`).join('');
    el('targetPage').textContent=number(targetPage)+' / '+number(targetPages);
  }catch(error){if(serial!==targetSerial)return;el('targetStatus').textContent=error.message;el('targetList').innerHTML='';el('targetPage').textContent='';targetPages=1;targetPage=1;}
  finally{if(serial===targetSerial){targetBusy=false;el('searchTargets').disabled=false;el('previousTargets').disabled=targetPage<=1;el('nextTargets').disabled=targetPage>=targetPages;}}
}
el('settingsForm').oninput=()=>{dirty=true;};
el('settingsForm').onsubmit=event=>{
  event.preventDefault();if(busy||!state)return;
  const cycle=Number(el('callsPerCycle').value),daily=Number(el('callsPerDay').value);
  if(!Number.isInteger(cycle)||cycle<1||cycle>1000||!Number.isInteger(daily)||daily<cycle||daily>2000){el('actionError').textContent='اختر حد جولة من ١ إلى ١٠٠٠، وحد يوم أكبر منه أو يساويه وحتى ٢٠٠٠.';el('actionError').hidden=false;return;}
  return action('جاري حفظ الإعدادات…',async()=>{await request(api+'/settings',{method:'PATCH',body:JSON.stringify({calls_per_cycle:cycle,calls_per_day:daily,auto_publish:el('autoPublish').checked})});dirty=false;},'تم حفظ حدود البحث وإعداد النشر.');
};
el('verifyConnection').onclick=()=>action('جاري اختبار اتصال Astra…',()=>request(api+'/verify',{method:'POST'}),'تم التحقق من الوصول إلى Astra. يمكنك تفعيل الجدول.');
el('toggleSchedule').onclick=()=>{if(!state)return;const enabled=!state.settings.enabled;return action(enabled?'جاري تفعيل الجدول…':'جاري إيقاف الجدول…',()=>request(api+'/settings',{method:'PATCH',body:JSON.stringify({enabled})}),enabled?'تم تفعيل الجدول بتوقيت سوريا.':'تم إيقاف البحث؛ إن كان هناك طلب جارٍ تُحفظ اكتشافاته للمراجعة.');};
el('runNow').onclick=()=>action('جاري إضافة جولة البحث…',()=>request(api+'/run',{method:'POST'}),'أُضيفت الجولة إلى قائمة التنفيذ. سيظهر تقدمها في السجل.');
el('refreshStatus').onclick=()=>action('جاري تحديث الحالة…',async()=>{},'تم تحديث الحالة.');
el('targetSearch').onsubmit=event=>{event.preventDefault();return targets(1);};
el('previousTargets').onclick=()=>!targetBusy&&targetPage>1?targets(targetPage-1):undefined;
el('nextTargets').onclick=()=>!targetBusy&&targetPage<targetPages?targets(targetPage+1):undefined;
try{
  const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'}),account=await response.json();
  if(!response.ok||account.user?.role!=='admin'){signedOut();return;}
  authorized=true;await load();el('pageStatus').hidden=true;el('manager').hidden=false;await targets();
  const timer=setInterval(()=>{if(authorized&&!busy&&!document.hidden)load().catch(error=>{el('actionError').textContent=error.message;el('actionError').hidden=false;});},30000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}catch(error){el('pageStatus').hidden=false;el('pageStatus').textContent=error.message||'تعذر الاتصال بالموقع.';}
})();
