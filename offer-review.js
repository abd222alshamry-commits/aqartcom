(() => {
'use strict';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses={pending:'بانتظار المراجعة',active:'نشط',published:'منشور',approved:'معتمد وغير منشور',rejected:'مرفوض',inactive:'غير نشط',duplicate:'مكرر'};
const kinds={property:'عقار',hotel:'إقامة',market:'عرض مكتب / مصدر'},lodgings={hotel:'فندق',furnished_apartment:'شقة مفروشة',farm:'مزرعة'};
const actions={create:'إضافة العرض',approve:'اعتماد',reject:'رفض',pending:'إعادة للمراجعة'};
let page=1,permissions={},current=null,offices=[],loadingId=0,detailId=0;
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options}),d=await r.json();if(!r.ok){const e=Error(d.error||'تعذر تنفيذ الطلب');e.status=r.status;throw e;}return d;}
const post=(url,body)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function safeURL(value){try{if(/^\/(uploads|assets)\/[a-zA-Z0-9._-]+$/.test(value))return value;const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function media(images=[],videos=[]){
 const imgs=(Array.isArray(images)?images:[]).map(m=>safeURL(typeof m==='string'?m:m?.url)).filter(Boolean);
 const vids=(Array.isArray(videos)?videos:[]).map(m=>({url:safeURL(typeof m==='string'?m:m?.url),title:m?.title||'رابط الفيديو'})).filter(m=>m.url);
 return `<div class="media">${imgs.map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="صورة العرض" loading="lazy" referrerpolicy="no-referrer"></a>`).join('')}</div>${vids.map(m=>`<p><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.title)}</a></p>`).join('')}`;
}
function moveTo(id){$(id).focus();$(id).scrollIntoView({behavior:'smooth',block:'start'});}
async function load(){
 const token=++loadingId;const query=new URLSearchParams(new FormData($('filters')));query.set('page',page);
 $('count').textContent='جارٍ تحميل العروض…';$('offers').setAttribute('aria-busy','true');
 try{
  const d=await api('/api/admin/offers?'+query);if(token!==loadingId)return;
  permissions=d;$('workspace').hidden=false;$('newOffer').hidden=!d.can_create;$('teamLink').hidden=!d.can_manage_team;
  const pages=Math.max(1,Math.ceil(d.total/d.page_size));if(page>pages){page=pages;return await load();}
  $('count').textContent=d.total+' عرضًا مطابقًا';$('pageLabel').textContent='صفحة '+page+' من '+pages;$('previous').disabled=page<=1;$('next').disabled=page>=pages;
  $('offers').innerHTML=d.data.length?d.data.map(o=>`<article class="offer"><span class="badge">${esc(kinds[o.kind])} · ${esc(lodgings[o.category]||o.category||'')}</span><h3>${esc(o.title||'عرض بلا عنوان')}</h3><p>${esc(o.city||'')} ${o.office_name?' · '+esc(o.office_name):''}</p><span class="badge">${esc(statuses[o.status]||o.status)}</span>${o.is_demo?' <span class="badge">تجريبي</span>':''}<br><button data-kind="${esc(o.kind)}" data-id="${esc(o.id)}">عرض التفاصيل والمراجعة</button></article>`).join(''):'<p>لا توجد عروض مطابقة لهذا البحث.</p>';
  $('offers').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>open(b.dataset.kind,b.dataset.id));
 }catch(e){if(token===loadingId){$('count').textContent=e.message;$('offers').innerHTML='';$('previous').disabled=$('next').disabled=true;if(e.status===401||e.status===403){$('workspace').hidden=true;$('message').textContent=e.message;$('signIn').hidden=false;}}}
 finally{if(token===loadingId)$('offers').removeAttribute('aria-busy');}
}
async function open(kind,id){
 const token=++detailId;current=null;$('detailPanel').hidden=false;$('decisionForm').hidden=true;$('detail').textContent='جارٍ تحميل تفاصيل العرض…';$('history').innerHTML='';$('decisionMessage').textContent='';
 try{
  const d=await api('/api/admin/offers/'+kind+'/'+id);if(token!==detailId)return;current=d;const o=d.data;
  $('detailTitle').textContent=o.title||o.name||'تفاصيل العرض';
  const facts=[['القسم',kinds[kind]],['الحالة',statuses[o.status]],['المكتب',o.office_name||o.advertiser_name],['الموقع',[o.city,o.district].filter(Boolean).join(' · ')],['النوع',lodgings[o.lodging_type]||o.type||o.property_type],['العملية',o.mode||({sale:'بيع',rent:'إيجار'}[o.listing_mode])],['السعر',o.price!=null?Number(o.price).toLocaleString('ar-SY')+' '+o.currency:null],['المساحة',o.area!=null?o.area+' م²':null],['هاتف التواصل',o.phone],['واتساب',o.whatsapp]];
  const images=kind==='market'?(Array.isArray(o.media)?o.media:[]).filter(m=>m?.type==='image'):[...(Array.isArray(o.images)?o.images:[]),...(o.image_url?[o.image_url]:[])];
  const videos=kind==='market'?(Array.isArray(o.media)?o.media:[]).filter(m=>m?.type==='video'):o.videos;
  $('detail').innerHTML=`<dl class="details">${facts.filter(f=>f[1]!=null&&f[1]!=='').map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl><p class="description">${esc(o.description)}</p>${o.is_demo?'<p class="notice">عرض تجريبي؛ لا يمكن اعتماده كعرض حقيقي.</p>':''}${safeURL(o.external_url)?`<a href="${esc(safeURL(o.external_url))}" target="_blank" rel="noopener noreferrer">فتح مرجع العرض</a>`:''}${media(images,videos)}${kind==='hotel'?`<h3>شروط الإقامة</h3><p class="description">${esc(o.rental_terms||'لم تُضف شروط بعد')}</p><p class="description">${esc(o.cancellation_policy||'')}</p><p>الدخول: ${esc(o.check_in_time)} · المغادرة: ${esc(o.check_out_time)}</p><h3>الغرف (${o.rooms.length})</h3>${o.rooms.map(r=>`<div class="room"><b>${esc(r.name)} — ${esc(statuses[r.status])}</b><p>${esc(r.description)}</p><p>${esc(r.price)} ${esc(r.currency)} · ${esc(r.max_guests)} ضيوف · العدد ${esc(r.quantity)}</p>${media(r.images,r.videos)}</div>`).join('')}`:''}`;
  $('history').innerHTML=d.history.length?d.history.map(e=>`<div class="history-item"><b>${esc(actions[e.action])} · ${esc(e.actor_name||'حساب محذوف')}</b><p>${esc(statuses[e.from_status]||'جديد')} ← ${esc(statuses[e.to_status])} · ${esc(new Date(e.created_at).toLocaleString('ar-SY'))}</p><p class="description">${esc(e.reason||'بلا ملاحظات')}</p></div>`).join(''):'<p>لا توجد قرارات مسجلة في شاشة المراجعة حتى الآن.</p>';
  $('decisionForm').reset();$('decisionForm').hidden=!permissions.can_review;$('decisionForm').elements.action.querySelector('[value=approve]').disabled=!!o.is_demo;
  if(o.is_demo)$('decisionForm').elements.action.value='pending';
  $('publicationHint').textContent=kind==='market'&&!o.publishable?'اعتماد هذا العرض يسجل الموافقة فقط؛ نشره يحتاج استكمال توثيق المصدر.':'الاعتماد يُظهر العرض للزوار. الرفض أو الإعادة للمراجعة يُخفيانه.';
  reasonRequired();moveTo('detailTitle');
 }catch(e){if(token===detailId)$('detail').textContent=e.message;}
}
function reasonRequired(){$('decisionForm').elements.reason.required=$('decisionForm').elements.action.value!=='approve';$('decisionForm').elements.reason.minLength=$('decisionForm').elements.reason.required?3:0;}
$('decisionForm').elements.action.onchange=reasonRequired;
$('decisionForm').onsubmit=async event=>{
 event.preventDefault();if(!current)return;const f=event.currentTarget,button=f.querySelector('button'),snapshot=current;button.disabled=true;$('decisionMessage').textContent='جارٍ حفظ القرار…';
 try{const d=await post('/api/admin/offers/'+snapshot.kind+'/'+snapshot.data.id+'/review',{...Object.fromEntries(new FormData(f)),revision:snapshot.revision});$('message').textContent=d.message;await load();await open(snapshot.kind,snapshot.data.id);$('decisionMessage').textContent=d.message;}
 catch(e){$('decisionMessage').textContent=e.message;if(e.status===409){current=null;const b=document.createElement('button');b.type='button';b.textContent='تحديث تفاصيل العرض';b.onclick=()=>open(snapshot.kind,snapshot.data.id);$('decisionMessage').append(' ',b);}}
 finally{button.disabled=false;}
};
$('newOffer').onclick=async()=>{
 $('createPanel').hidden=false;$('createMessage').textContent='جارٍ تحميل المكاتب…';const submit=$('createForm').querySelector('button');submit.disabled=true;
 try{const d=await api('/api/admin/offers/offices');offices=d.data;const field=$('createForm').elements.office,selected=field.value;field.innerHTML='<option value="">اختر المكتب</option>'+offices.map(o=>`<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('');field.value=selected;$('officeHint').textContent=offices.length?'اختر مكتبًا مسجلاً أو أحد مكاتب المصادر المتاحة.':'لا توجد مكاتب بعد؛ أضف مكتبًا من قسم المكاتب أو مصدرًا من إدارة المصادر أولًا.';$('createMessage').textContent='';submit.disabled=!offices.length;moveTo('createTitle');}catch(e){$('createMessage').textContent=e.message;}
};
$('createForm').onsubmit=async event=>{
 event.preventDefault();const f=event.currentTarget,button=f.querySelector('button');button.disabled=true;$('createMessage').textContent='جارٍ حفظ العرض…';
 try{const body=Object.fromEntries(new FormData(f));body.images=body.images.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);const d=await post('/api/admin/offers/office-listings',body);f.reset();$('message').textContent=d.message;$('createMessage').textContent=d.message;$('createPanel').hidden=true;$('filters').reset();$('filters').elements.kind.value='market';$('filters').elements.status.value='pending';page=1;await load();await open('market',d.data.id);}catch(e){$('createMessage').textContent=e.message;}finally{button.disabled=false;}
};
$('closeCreate').onclick=()=>{$('createPanel').hidden=true;$('newOffer').focus();};
$('closeDetail').onclick=()=>{detailId++;current=null;$('detailPanel').hidden=true;$('filters').querySelector('button').focus();};
$('filters').onsubmit=event=>{event.preventDefault();page=1;load();};$('previous').onclick=()=>{page--;load();};$('next').onclick=()=>{page++;load();};
$('loginForm').onsubmit=async event=>{event.preventDefault();const f=event.currentTarget,b=f.querySelector('button');b.disabled=true;try{await post('/api/auth/login',Object.fromEntries(new FormData(f)));f.elements.password.value='';await boot();}catch(e){$('message').textContent=e.message;}finally{b.disabled=false;}};
$('logout').onclick=async()=>{try{await post('/api/auth/logout',{});location.reload();}catch(e){$('message').textContent=e.message;}};
async function boot(){
 $('message').textContent='';$('workspace').hidden=true;$('signIn').hidden=true;
 try{const d=await api('/api/auth/me');$('logout').hidden=!d.user;if(!d.user||d.user.role!=='admin'){$('signIn').hidden=false;if(d.user)$('message').textContent='هذا الحساب لا يملك صلاحية المراجعة. سجّل الدخول بحساب المشرف.';return;}$('account').textContent='حساب المشرف: '+d.user.name;await load();}catch(e){$('message').textContent=e.message;$('signIn').hidden=false;}
}
boot();
})();
