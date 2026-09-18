(() => {
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const kinds={property:'عقار',market:'عرض مكتب',hotel:'إقامة'};
 let permissionVersion=0,timer;const checked=new Set(),grantsCache=new Map();
 const key=h=>h.dataset.listingKind+':'+h.dataset.listingId;
 const path=(kind,id)=>kind==='property'?'/property.html?id='+id:kind==='market'?'/office-property.html?id='+id:'/hotels.html?hotel='+id;
 async function api(url,options={}){
  const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});let d;
  try{d=await r.json();}catch{throw Error('تعذر الاتصال بالموقع. حاول مجددًا');}
  if(!r.ok){const e=Error(d.error||'تعذر تنفيذ العملية');e.status=r.status;throw e;}return d;
 }
 const request=(url,method,body)=>api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 function modal(title){
  const previous=document.activeElement,d=document.createElement('dialog');d.className='listing-dialog';
  d.innerHTML=`<div class="listing-dialog-head"><h2>${esc(title)}</h2><button type="button" class="listing-close" aria-label="إغلاق">×</button></div><div class="listing-dialog-body"></div>`;
  document.body.append(d);d.querySelector('.listing-close').onclick=()=>close();
  const close=()=>{d.remove();if(previous?.isConnected)previous.focus();};
  d.addEventListener('cancel',e=>{e.preventDefault();close();});
  if(d.showModal)d.showModal();else d.setAttribute('open','');
  return {dialog:d,body:d.querySelector('.listing-dialog-body'),close};
 }
 function share(kind,id,title){
  const url=new URL(path(kind,id),location.origin).href,m=modal('مشاركة الإعلان');
  m.body.innerHTML=`<p>${esc(title)}</p><div class="listing-share-options">${navigator.share?'<button type="button" data-native-share>مشاركة عبر تطبيقات الهاتف</button>':''}<a class="listing-whatsapp" href="https://wa.me/?text=${encodeURIComponent((title||'إعلان في عقارتكم')+'\n'+url)}" target="_blank" rel="noopener noreferrer">مشاركة عبر واتساب</a><button type="button" data-copy-link>نسخ الرابط</button></div><label>رابط الإعلان<input class="listing-share-url" value="${esc(url)}" readonly dir="ltr"></label><p role="status" data-share-status></p>`;
  const note=m.body.querySelector('[data-share-status]'),input=m.body.querySelector('input');
  m.body.querySelector('[data-native-share]')?.addEventListener('click',async()=>{try{await navigator.share({title:title||'إعلان في عقارتكم',url});}catch(e){if(e.name!=='AbortError')note.textContent='تعذرت المشاركة المباشرة؛ استخدم واتساب أو نسخ الرابط.';}});
  m.body.querySelector('[data-copy-link]').onclick=async()=>{
   try{if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');await navigator.clipboard.writeText(url);note.textContent='تم نسخ رابط الإعلان';}
   catch{input.focus();input.select();let copied=false;try{copied=!!document.execCommand?.('copy');}catch{}note.textContent=copied?'تم نسخ رابط الإعلان':'الرابط محدد؛ اضغط مطولًا واختر نسخ.';}
  };
 }
 const labels={title:'عنوان الإعلان',name:'اسم المنشأة',type:'نوع العقار',property_type:'نوع العقار',mode:'العملية',listing_mode:'العملية',city:'المدينة / المحافظة',district:'البلدة / الحي',price:'السعر',currency:'العملة',area:'المساحة م²',rooms:'عدد الغرف',baths:'دورات المياه',description:'وصف الإعلان',latitude:'خط العرض',longitude:'خط الطول',phone:'هاتف المعلن',whatsapp:'واتساب المعلن',address:'العنوان',lodging_type:'نوع الإقامة',rental_terms:'شروط التأجير',cancellation_policy:'شروط الإلغاء'};
 const choices={mode:[['بيع','بيع'],['إيجار','إيجار']],listing_mode:[['sale','بيع'],['rent','إيجار']],lodging_type:[['hotel','فندق'],['furnished_apartment','شقة مفروشة'],['farm','مزرعة']],currency:['USD','SYP','EUR','SAR','AED','GBP','KWD','QAR','BHD','OMR','JOD','CAD','AUD','JPY','CHF','SGD'].map(x=>[x,x])};
 function field(name,value,kind){
  const long=['description','rental_terms','cancellation_policy','address'].includes(name),number=['price','area','rooms','baths','latitude','longitude'].includes(name);
  const required=['title','name','city','type','property_type','mode','listing_mode','currency','lodging_type'].includes(name)||(name==='price'&&kind==='property');
  const limits={title:200,name:180,city:100,district:120,type:80,property_type:80,description:10000,address:1000,rental_terms:10000,cancellation_policy:10000,phone:40,whatsapp:40};
  const attributes=`name="${name}" ${required?'required':''}`;
  const options=choices[name];
  return `<label class="${long?'listing-full':''}">${labels[name]}${options?`<select ${attributes}>${options.map(([v,label])=>`<option value="${v}" ${String(value)===v?'selected':''}>${label}</option>`).join('')}</select>`:long?`<textarea ${attributes} rows="4" maxlength="${limits[name]}">${esc(value)}</textarea>`:`<input ${attributes} type="${number?'number':'text'}" ${number?`step="${['rooms','baths'].includes(name)?'1':name==='latitude'||name==='longitude'?'0.0000001':'0.01'}" ${['latitude','longitude'].includes(name)?'':'min="0"'}`:`maxlength="${limits[name]||200}"`} value="${esc(value)}">`}</label>`;
 }
 function changed(kind,id,operation){
  refreshPermissions();window.dispatchEvent(new CustomEvent('listing:changed',{detail:{kind,id,operation}}));
  if(document.getElementById('managedListings'))return;
  if(operation==='delete'&&['/property.html','/office-property.html'].includes(location.pathname))location.href='/my-listings.html';
  else location.reload();
 }
 async function manage(kind,id,operation){
  const m=modal(operation==='delete'?'حذف الإعلان':'تعديل الإعلان');m.body.textContent='جارٍ تحميل أحدث بيانات الإعلان…';
  try{
   const result=await api('/api/listing-management/'+kind+'/'+id);if(!m.dialog.isConnected)return;
   const item=result.data,title=item.title||item.name||'الإعلان';
   if(operation==='delete'){
    m.body.innerHTML=`<p>هل تريد حذف «${esc(title)}» من الموقع؟</p><p>سيختفي عن الزوار، مع الاحتفاظ بسجله${kind==='hotel'?' والحجوزات السابقة':''}.</p><form><div class="listing-dialog-actions"><button type="submit" class="listing-delete">تأكيد الحذف</button><button type="button" data-cancel>إلغاء</button></div><p role="status" data-edit-status></p></form>`;
   }else{
    m.body.innerHTML=`<form><div class="listing-edit-grid">${Object.keys(labels).filter(name=>Object.hasOwn(item,name)).map(name=>field(name,item[name]??'',kind)).join('')}</div>${kind==='hotel'?'<p><a href="/hotel-partner.html">إدارة الغرف والأسعار والصور</a></p>':''}<div class="listing-dialog-actions"><button type="submit">حفظ التعديل</button><button type="button" data-cancel>إلغاء</button></div><p role="status" data-edit-status></p></form>`;
   }
   const form=m.body.querySelector('form'),note=m.body.querySelector('[data-edit-status]');
   m.body.querySelector('[data-cancel]').onclick=m.close;
   form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;note.textContent='جارٍ الحفظ…';
    try{
     const changes={};if(operation==='edit')for(const [name,value] of new FormData(form))if(String(item[name]??'')!==value)changes[name]=value;
     if(operation==='edit'&&!Object.keys(changes).length){note.textContent='لم تغيّر أي بيانات بعد.';return;}
     const d=await request('/api/listing-management/'+kind+'/'+id,operation==='delete'?'DELETE':'PATCH',{revision:result.revision,changes});
     m.close();changed(kind,id,operation);window.dispatchEvent(new CustomEvent('listing:message',{detail:d.message}));
    }catch(e){note.textContent=e.message;if(e.status===409){const reload=document.createElement('button');reload.type='button';reload.textContent='فتح أحدث بيانات الإعلان';reload.onclick=()=>{m.close();manage(kind,id,operation);};note.append(' ',reload);}}
    finally{button.disabled=false;}
   };
  }catch(e){m.body.textContent=e.message;if(e.status===401){const a=document.createElement('a');a.href='/my-listings.html';a.textContent=' تسجيل الدخول';m.body.append(a);}}
 }
 function buttons(host){
  if(host.dataset.actionsReady)return;
  const {listingKind:kind,listingId:id}=host.dataset;
  if(!Object.hasOwn(kinds,kind)||!/^[1-9]\d{0,17}$/.test(id||''))return;
  host.dataset.actionsReady='1';host.classList.add('listing-actions');
  host.setAttribute('aria-label','إجراءات الإعلان');
  host.innerHTML='<button type="button" data-listing-share>مشاركة</button><button type="button" data-listing-edit hidden>تعديل</button><button type="button" data-listing-delete class="listing-delete" hidden>حذف</button>';
  host.addEventListener('click',e=>e.stopPropagation());
  host.querySelector('[data-listing-share]').onclick=()=>share(kind,id,host.dataset.title||'إعلان في عقارتكم');
  host.querySelector('[data-listing-edit]').onclick=()=>manage(kind,id,'edit');
  host.querySelector('[data-listing-delete]').onclick=()=>manage(kind,id,'delete');
 }
 async function scan(){
  const hosts=[...document.querySelectorAll('[data-listing-kind][data-listing-id]')];hosts.forEach(buttons);for(const h of hosts){const g=grantsCache.get(key(h));if(g&&h.dataset.actionsReady){h.querySelector('[data-listing-edit]').hidden=!g.can_edit;h.querySelector('[data-listing-delete]').hidden=!g.can_delete;}}
  const pending=hosts.filter(h=>h.dataset.actionsReady&&!checked.has(key(h)));if(!pending.length)return;
  const items=[...new Map(pending.map(h=>[key(h),{kind:h.dataset.listingKind,id:h.dataset.listingId}])).values()].slice(0,60);
  const token=permissionVersion;items.forEach(x=>checked.add(x.kind+':'+x.id));
  try{
   const d=await request('/api/listing-management/capabilities','POST',{items});if(token!==permissionVersion)return;
   const grants=new Map(d.data.map(x=>[x.kind+':'+x.id,x]));for(const [k,v] of grants)grantsCache.set(k,v);
   for(const h of hosts){const grant=grants.get(key(h));if(!grant)continue;h.querySelector('[data-listing-edit]').hidden=!grant.can_edit;h.querySelector('[data-listing-delete]').hidden=!grant.can_delete;}
  }catch{ /* Public sharing remains usable when authentication or the network is unavailable. */ }
  if(items.length===60)schedule();
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(scan,30);}
 function refreshPermissions(){permissionVersion++;checked.clear();grantsCache.clear();document.querySelectorAll('[data-listing-edit],[data-listing-delete]').forEach(b=>b.hidden=true);schedule();}
 function initialize(){
  const host=document.getElementById('siteNav')||document.querySelector('header .container.nav,header nav,header .head-actions,header');
  if(host&&!host.querySelector('a[href="/my-listings.html"]')){const a=document.createElement('a');a.href='/my-listings.html';a.className='listing-manage-link';a.textContent='إدارة الإعلانات';host.append(a);}
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});schedule();
  window.addEventListener('focus',refreshPermissions);
 }
 window.ListingActions={share,manage,refreshPermissions,api};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
