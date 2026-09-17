const API='/api';
bindSyriaLocations(document);
let properties=[];let favorites=new Set();let currentMode='';let currentUser=null;let displayCurrency=localStorage.getItem('aqartkom_display_currency')||'USD';let fxCache={};let geoSearch={lat:null,lng:null,radiusKm:5,marker:null,map:null,layer:null,polygon:[],polygonLayer:null,drawing:false};
const grid=document.getElementById('cards'),toast=document.getElementById('toast');
function money(v,c='USD'){const cur=String(c||'USD').toUpperCase();const symbols={USD:'$',EUR:'€',SAR:'ر.س',AED:'د.إ',GBP:'£',SYP:'ل.س',KWD:'د.ك',QAR:'ر.ق',BHD:'د.ب',OMR:'ر.ع',JOD:'د.أ',CAD:'C$',AUD:'A$',JPY:'¥',CHF:'CHF',SGD:'S$'};return `${symbols[cur]||cur} ${Number(v||0).toLocaleString('en-US',{maximumFractionDigits:2})}`}
async function fxRate(from,to){from=String(from||'USD').toUpperCase();to=String(to||'USD').toUpperCase();if(from===to)return 1;const key=from+'_'+to;if(fxCache[key])return fxCache[key];const r=await fetch(`${API}/fx/convert?amount=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);const j=await r.json();if(!r.ok||!Number.isFinite(Number(j.rate)))throw new Error('fx');fxCache[key]=Number(j.rate);return fxCache[key]}
async function convertedMoney(v,from){try{return money(Number(v)*await fxRate(from,displayCurrency),displayCurrency)}catch{return money(v,from)}}
function kindFor(t){return t==='أرض'?'land':t==='فيلا'?'villa':t==='محل تجاري'?'interior':'building'}
const builtInPropertyImages={villa:'/assets/property-villa.webp',interior:'/assets/property-interior.webp',building:'/assets/property-building.webp',land:'/assets/property-building.webp'};
function propertyImage(p){return p.image_url||builtInPropertyImages[kindFor(p.type)]||builtInPropertyImages.building}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function youtubeId(url=''){const m=url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^?&/]+)/i);return m?m[1]:''}
function videoThumb(v){const id=v&&youtubeId(v.url||'');return id?`https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`:''}
function videoLabel(v){return v?.source_type==='youtube'?'YouTube':v?.source_type==='external'?'رابط خارجي':'فيديو العقار'}
function openCardVideo(v,e){e?.stopPropagation();if(v)window.PropertyVideo?.open(v);}
let listingPage=1,displayedProperties=[];
function render(list=properties,keepPage=false){if(!keepPage)listingPage=1;displayedProperties=list;const pages=Math.max(1,Math.ceil(list.length/10));listingPage=Math.min(listingPage,pages);const start=(listingPage-1)*10,pageRows=list.slice(start,start+10);renderListingPagination(list.length,pages,start);const notice=document.getElementById('demoNotice');if(notice)notice.hidden=!list.some(p=>p.is_demo);grid.innerHTML=pageRows.map(p=>{if(p.source_kind==='office')return officeListingCard(p);const pv=p.primary_video;const thumb=videoThumb(pv);const photo=propertyImage(p);const media=pv?`<div class="card-main-video" style="background-image:url('${escapeHtml(thumb||photo)}')"><button type="button" class="play-main" aria-label="تشغيل الفيديو بملء الشاشة" data-video='${escapeHtml(JSON.stringify(pv))}'>▶</button><small>فيديو</small></div>`:`<img class="property-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(p.title)}" loading="lazy">`;return `<article class="property-card" data-id="${p.id}"><div class="property-image ${kindFor(p.type)}">${p.is_demo?'<span class="badge demo-badge">إعلان تجريبي</span>':''}${p.sponsored?'<span class="badge sponsored-badge">إعلان ممول</span>':''}${p.featured?'<span class="badge">مميز</span>':''}<button class="heart ${favorites.has(Number(p.id))?'liked':''}" data-fav="${p.id}">${favorites.has(Number(p.id))?'♥':'♡'}</button>${media}<span class="price" data-price="${p.price}" data-price-currency="${escapeHtml(p.currency||'USD')}">${money(p.price,p.currency||'USD')}</span></div><div class="card-body"><h3>${escapeHtml(p.title)}</h3><div class="location">⌖ ${escapeHtml(p.city)} - ${escapeHtml(p.district||'')}</div><div class="meta"><span>▦ ${p.area?p.area+' م²':'—'}</span><span>🛏 ${p.rooms??'—'}</span><span>♨ ${p.baths??'—'}</span></div></div></article>`}).join('')||'<div style="grid-column:1/-1;padding:40px;text-align:center;color:#788494">لا توجد عقارات مطابقة للبحث.</div>';document.querySelectorAll('[data-fav]').forEach(b=>b.onclick=async e=>{e.stopPropagation();await toggleFavorite(Number(b.dataset.fav));});document.querySelectorAll('.play-main').forEach(b=>b.onclick=e=>{try{openCardVideo(JSON.parse(b.dataset.video),e)}catch(_){}});document.querySelectorAll('.property-card').forEach(c=>c.onclick=()=>{const p=properties.find(x=>String(x.id)===String(c.dataset.id));if(p?.ad?.id)fetch(`${API}/ads/events`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ad_id:p.ad.id,event_type:'click',property_id:p.id})}).catch(()=>{});location.href='/property.html?id='+encodeURIComponent(c.dataset.id)});pageRows.filter(p=>p.sponsored&&p.ad?.id).forEach(p=>fetch(`${API}/ads/events`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ad_id:p.ad.id,event_type:'impression',property_id:p.id})}).catch(()=>{}));}

function renderListingPagination(total,pages,start){
 const summary=document.getElementById('listingPageSummary'),pager=document.getElementById('listingPagination');
 summary.textContent=total?`عرض ${start+1}–${Math.min(start+10,total)} من ${total} إعلانًا · الأحدث أولًا`:'لا توجد إعلانات مطابقة للبحث.';
 pager.hidden=pages<=1;
 pager.innerHTML=`<button type="button" data-page="${listingPage-1}" ${listingPage===1?'disabled':''}>السابق</button>`+Array.from({length:pages},(_,i)=>`<button type="button" data-page="${i+1}" aria-label="الصفحة ${i+1}" ${listingPage===i+1?'aria-current="page"':''}>${i+1}</button>`).join('')+`<button type="button" data-page="${listingPage+1}" ${listingPage===pages?'disabled':''}>التالي</button>`;
}
document.getElementById('listingPagination').addEventListener('click',event=>{
 const button=event.target.closest('button[data-page]');if(!button||button.disabled)return;
 listingPage=Number(button.dataset.page);render(displayedProperties,true);refreshDisplayedPrices();
 const summary=document.getElementById('listingPageSummary');summary.tabIndex=-1;summary.focus({preventScroll:true});summary.scrollIntoView({block:'start',behavior:'instant'});
});
['officeFilter','availabilityFilter'].forEach(id=>document.getElementById(id).addEventListener('change',refreshGeoSearch));

async function refreshDisplayedPrices(){const nodes=[...document.querySelectorAll('[data-price][data-price-currency]')];await Promise.all(nodes.map(async n=>{try{const r=await fxRate(n.dataset.priceCurrency,displayCurrency);n.textContent=money(Number(n.dataset.price)*r,displayCurrency)}catch{}}));}
function setupCurrency(){const el=document.getElementById('displayCurrency');if(!el)return;el.value=displayCurrency;const hint=()=>{const h=document.getElementById('priceCurrencyHint');if(h)h.textContent='بالعملة '+displayCurrency};hint();el.onchange=()=>{displayCurrency=el.value;localStorage.setItem('aqartkom_display_currency',displayCurrency);hint();refreshDisplayedPrices();refreshGeoSearch();}}
function updateGeoMarkers(){if(!geoSearch.map||typeof L==='undefined')return;if(geoSearch.layer)geoSearch.map.removeLayer(geoSearch.layer);geoSearch.layer=L.layerGroup().addTo(geoSearch.map);properties.filter(p=>p.latitude!=null&&p.longitude!=null&&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))).forEach(p=>{const label=p.sponsored?'إعلان ممول — ':'';const m=L.marker([Number(p.latitude),Number(p.longitude)]).addTo(geoSearch.layer);m.bindPopup(`<b>${escapeHtml(label+p.title)}</b><br>${escapeHtml(p.city)}${p.district?' - '+escapeHtml(p.district):''}<br><strong>${money(p.price_display??p.price,p.display_currency||p.currency||'USD')}</strong><br><button type="button" onclick="location.href='/property.html?id=${encodeURIComponent(p.id)}'">عرض العقار</button>`);});}
function updateGeoNote(){const n=document.getElementById('geoNote');if(!n)return;n.textContent=geoSearch.lat===null?'تظهر على الخريطة الإعلانات ذات الإحداثيات المحددة فقط. اضغط لاختيار موقع البحث.':`تم اختيار موقع البحث ضمن نطاق ${geoSearch.radiusKm} كم — سيتم عرض العقارات والإعلانات الموجودة داخله.`;}
async function refreshGeoSearch(){
 const city=document.getElementById('city')?.value||'',type=document.getElementById('type')?.value||'',min=document.getElementById('min')?.value||'',max=document.getElementById('max')?.value||'',rooms=document.getElementById('rooms')?.value||'';
 const commuteMinutes=document.getElementById('commuteMinutes')?.value||'',commuteMode=document.getElementById('commuteMode')?.value||'drive';
 if(geoSearch.polygon.length>=3||commuteMinutes){try{const r=await fetch(`${API}/properties/geo-search`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({office:document.getElementById('officeFilter').value,availability:document.getElementById('availabilityFilter').value,mode:currentMode,city,district:document.getElementById('district').value.trim(),type,minPrice:min,maxPrice:max,rooms,polygon:geoSearch.polygon.length>=3?geoSearch.polygon:null,center:geoSearch.lat!==null?{lat:geoSearch.lat,lng:geoSearch.lng}:null,radiusKm:geoSearch.polygon.length?0:geoSearch.radiusKm,commuteMinutes,commuteMode})});const j=await r.json();if(!r.ok)throw Error(j.error);properties=j.data;render(properties);updateGeoMarkers();document.getElementById('geoNote').innerHTML=`تم العثور على <strong>${j.count}</strong> عقار${j.approximate_commute?' — وقت الوصول تقديري حسب المسافة':''}.`;return}catch(e){showToast(e.message)}}
 const parts=[`currency=${encodeURIComponent(displayCurrency)}`,`mode=${encodeURIComponent(currentMode)}`];if(city)parts.push(`city=${encodeURIComponent(city)}`);if(type)parts.push(`type=${encodeURIComponent(type)}`);if(min)parts.push(`minPrice=${encodeURIComponent(min)}`);if(max)parts.push(`maxPrice=${encodeURIComponent(max)}`);if(rooms)parts.push(`rooms=${encodeURIComponent(rooms)}`);loadProperties(parts.join('&'),'search');
}
function setGeo(lat,lng){geoSearch.lat=Number(lat);geoSearch.lng=Number(lng);if(geoSearch.map){if(geoSearch.marker)geoSearch.marker.setLatLng([lat,lng]);else geoSearch.marker=L.marker([lat,lng]).addTo(geoSearch.map);geoSearch.map.setView([lat,lng],13)}updateGeoNote();refreshGeoSearch();}
function initGeoMap(){const el=document.getElementById('searchMap');if(!el||typeof L==='undefined')return;geoSearch.map=L.map(el).setView([33.5138,36.2765],6);addPropertyBasemaps(geoSearch.map);geoSearch.map.on('click',e=>{if(geoSearch.drawing){geoSearch.polygon.push([e.latlng.lat,e.latlng.lng]);if(geoSearch.polygonLayer)geoSearch.map.removeLayer(geoSearch.polygonLayer);geoSearch.polygonLayer=L.polygon(geoSearch.polygon,{dashArray:'6,5'}).addTo(geoSearch.map);updateGeoNote();}else setGeo(e.latlng.lat,e.latlng.lng)});document.getElementById('radiusKm')?.addEventListener('change',e=>{geoSearch.radiusKm=Number(e.target.value)||5;if(geoSearch.lat!==null)refreshGeoSearch();updateGeoNote()});document.getElementById('drawArea')?.addEventListener('click',e=>{geoSearch.drawing=true;geoSearch.polygon=[];if(geoSearch.polygonLayer){geoSearch.map.removeLayer(geoSearch.polygonLayer);geoSearch.polygonLayer=null}e.currentTarget.classList.add('active');document.getElementById('geoNote').textContent='اضغط عدة نقاط على الخريطة لرسم حدود المنطقة ثم اضغط إنهاء الرسم.'});document.getElementById('finishArea')?.addEventListener('click',()=>{if(geoSearch.polygon.length<3)return showToast('اختر 3 نقاط على الأقل');geoSearch.drawing=false;document.getElementById('drawArea')?.classList.remove('active');geoSearch.map.fitBounds(geoSearch.polygonLayer.getBounds());refreshGeoSearch()});['commuteMode','commuteMinutes'].forEach(id=>document.getElementById(id)?.addEventListener('change',()=>{if(document.getElementById('commuteMinutes')?.value&&geoSearch.lat===null)return showToast('حدد نقطة الوصول على الخريطة أولاً');refreshGeoSearch()}));document.getElementById('clearGeo')?.addEventListener('click',()=>{geoSearch.lat=null;geoSearch.lng=null;geoSearch.polygon=[];geoSearch.drawing=false;if(geoSearch.marker){geoSearch.map.removeLayer(geoSearch.marker);geoSearch.marker=null}if(geoSearch.polygonLayer){geoSearch.map.removeLayer(geoSearch.polygonLayer);geoSearch.polygonLayer=null}document.getElementById('drawArea')?.classList.remove('active');document.getElementById('commuteMinutes').value='';updateGeoNote();refreshGeoSearch()});document.getElementById('useMyLocation')?.addEventListener('click',()=>{if(!navigator.geolocation)return showToast('المتصفح لا يدعم تحديد الموقع');navigator.geolocation.getCurrentPosition(pos=>setGeo(pos.coords.latitude,pos.coords.longitude),err=>showToast(err.code===1?'اسمح للموقع بالوصول إلى موقعك من إعدادات المتصفح، أو اختر نقطة على الخريطة.':'تعذر الحصول على موقعك. اختر الموقع من الخريطة.'),{enableHighAccuracy:true,timeout:12000,maximumAge:60000})});updateGeoNote();updateGeoMarkers();}

let propertiesLoadVersion=0;
async function loadProperties(params='', placement='homepage'){const loadVersion=++propertiesLoadVersion;document.getElementById('listingPageSummary').textContent='جاري البحث...';try{const filters=new URLSearchParams(params);filters.set('includeOffices','true');filters.set('limit','100');filters.set('office',document.getElementById('officeFilter').value);filters.set('availability',document.getElementById('availabilityFilter').value);if(!filters.has('mode')&&currentMode)filters.set('mode',currentMode);const selectedCity=document.getElementById('city').value;const selectedTown=document.getElementById('district').value.trim();if(selectedTown&&(!filters.has('city')||filters.get('city')===selectedCity)){if(selectedCity)filters.set('city',selectedCity);filters.set('district',selectedTown);}params=filters.toString();const geo=geoSearch.lat!==null&&geoSearch.lng!==null?`lat=${encodeURIComponent(geoSearch.lat)}&lng=${encodeURIComponent(geoSearch.lng)}&radiusKm=${encodeURIComponent(geoSearch.radiusKm)}`:'';const qs=[params,geo].filter(Boolean).join('&'); const url=`${API}/properties?${qs}${qs?'&':''}placement=${encodeURIComponent(placement)}`;const r=await fetch(url);const j=await r.json();if(loadVersion!==propertiesLoadVersion)return;if(!r.ok)throw Error(j.error);properties=j.data;render(properties);updateGeoMarkers();refreshDisplayedPrices()}catch(e){if(loadVersion!==propertiesLoadVersion)return;properties=[];render([]);document.getElementById('listingPageSummary').textContent='تعذر تحميل الإعلانات؛ أعد البحث للمحاولة مجددًا.';showToast(e.message||'تعذر تحميل العقارات')}}
async function loadProperty(id){const r=await fetch(`${API}/properties/${id}`),j=await r.json();if(r.ok)showToast(`${j.data.title} — ${money(j.data.price)}`)}
async function me(){const r=await fetch(`${API}/auth/me`,{credentials:'same-origin'});const j=await r.json();currentUser=j.user;updateAuthUI();if(currentUser){const f=await fetch(`${API}/me/favorites`,{credentials:'same-origin'});if(f.ok){favorites=new Set((await f.json()).data);document.querySelector('#fav span').textContent=favorites.size}}}
function updateAuthUI(){const btn=document.getElementById('login');if(currentUser){btn.textContent=currentUser.name;btn.onclick=openUserAccount}else{btn.textContent='دخول / تسجيل';btn.onclick=openAuth}}
function showToast(m){toast.textContent=m;toast.classList.add('show');clearTimeout(window.__t);window.__t=setTimeout(()=>toast.classList.remove('show'),2800)}
async function toggleFavorite(id){if(!currentUser){openAuth();showToast('سجّل الدخول لحفظ العقارات في المفضلة');return}const has=favorites.has(id);const r=await fetch(`${API}/me/favorites/${id}`,{method:has?'DELETE':'POST',credentials:'same-origin'});if(r.status===401){openAuth();return}if(r.ok){has?favorites.delete(id):favorites.add(id);document.querySelector('#fav span').textContent=favorites.size;render(properties);showToast(has?'تمت إزالة العقار من المفضلة':'تمت إضافة العقار إلى المفضلة')}}
function modalHtml(id,title,body){
 let m=document.getElementById(id);const previousFocus=document.activeElement;
 if(!m){m=document.createElement('div');m.id=id;m.className='modal';}
 document.body.appendChild(m);
 m.innerHTML=`<div class="modalbox" role="dialog" aria-modal="true" tabindex="-1"><button class="modalclose" type="button" aria-label="إغلاق النافذة">×</button>${title}${body}</div>`;
 const box=m.querySelector('.modalbox');box.setAttribute('aria-label',box.querySelector('h2')?.textContent||'نافذة');
 bindSyriaLocations(m);m.classList.add('open');
 m.style.zIndex=String(2000+document.querySelectorAll('.modal.open').length);
 const close=()=>{m.classList.remove('open');m.querySelectorAll('video').forEach(v=>v.pause());m.querySelectorAll('iframe').forEach(f=>f.remove());if(previousFocus?.isConnected)previousFocus.focus();};
 m.querySelector('.modalclose').onclick=close;m.onclick=e=>{if(e.target===m)close()};
 m.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key!=='Tab')return;
 const items=[...box.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
 if(!items.length){e.preventDefault();box.focus();return;}const first=items[0],last=items.at(-1);
 if(e.shiftKey&&(document.activeElement===first||document.activeElement===box)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};
 requestAnimationFrame(()=>box.focus());return m;
}
function openAuth(){const m=modalHtml('authModal','<h2>تسجيل الدخول</h2><p>ادخل إلى حسابك في عقارتكم.</p>','<div class="auth-tabs"><button class="auth-tab active" data-auth="login">دخول</button><button class="auth-tab" data-auth="register">حساب جديد</button></div><form id="authForm"><input name="email" type="email" required placeholder="البريد الإلكتروني"><input name="password" type="password" minlength="8" required placeholder="كلمة المرور"><div id="registerFields"></div><button class="auth-submit">دخول</button></form><p id="authError" class="auth-error"></p>');let mode='login';const form=m.querySelector('#authForm');m.querySelectorAll('.auth-tab').forEach(t=>t.onclick=()=>{mode=t.dataset.auth;m.querySelectorAll('.auth-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');m.querySelector('h2').textContent=mode==='login'?'تسجيل الدخول':'إنشاء حساب';m.querySelector('.auth-submit').textContent=mode==='login'?'دخول':'إنشاء الحساب';m.querySelector('#registerFields').innerHTML=mode==='login'?'':'<input name="name" minlength="2" required placeholder="الاسم الكامل"><input name="phone" placeholder="رقم الهاتف">'});form.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));const r=await fetch(`${API}/auth/${mode}`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(data)});const j=await r.json();if(!r.ok){m.querySelector('#authError').textContent=j.error||'حدث خطأ';return}m.remove();currentUser=j.user;updateAuthUI();await me();showToast(mode==='login'?'تم تسجيل الدخول بنجاح':'تم إنشاء الحساب بنجاح')}}
async function openSavedSearches(){
  if(!currentUser){openAuth();return}
  const r=await fetch(`${API}/me/saved-searches`,{credentials:'same-origin'}); const j=await r.json();
  const rows=(j.data||[]).map(x=>{const c={in_app:true,push:false,email:false,whatsapp:false,...(x.notification_channels||{})};return `<div class="account-card"><b>${escapeHtml(x.name)}</b><span>${escapeHtml(JSON.stringify(x.filters||{}))}</span><small>${x.alerts_enabled?'🔔 التنبيهات مفعلة':'🔕 التنبيهات متوقفة'} — ${x.unread_count||0} جديد</small><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin:10px 0"><label><input type="checkbox" data-ch="in_app" data-search="${x.id}" ${c.in_app?'checked':''}> داخل التطبيق</label><label><input type="checkbox" data-ch="push" data-search="${x.id}" ${c.push?'checked':''}> Push للموبايل</label><label><input type="checkbox" data-ch="email" data-search="${x.id}" ${c.email?'checked':''}> البريد الإلكتروني</label><label><input type="checkbox" data-ch="whatsapp" data-search="${x.id}" ${c.whatsapp?'checked':''}> واتساب</label></div><div style="display:flex;gap:8px"><button data-save-channels="${x.id}">حفظ القنوات</button><button data-toggle-alert="${x.id}" data-enabled="${x.alerts_enabled}">${x.alerts_enabled?'إيقاف التنبيه':'تفعيل التنبيه'}</button><button data-delete-search="${x.id}">حذف</button></div></div>`}).join('')||'<p>لا توجد عمليات بحث محفوظة.</p>';
  const m=modalHtml('savedSearchesModal','<h2>عمليات البحث والتنبيهات</h2><p>اختر القنوات التي تريدها لكل بحث محفوظ. Push يحتاج تفعيل إشعارات المتصفح.</p>',rows+`<div style="margin-top:12px"><button id="enablePushBtn" class="primary">🔔 تفعيل Push على هذا الجهاز</button></div>`);
  m.querySelectorAll('[data-save-channels]').forEach(b=>b.onclick=async()=>{const id=b.dataset.saveChannels;const channels={};m.querySelectorAll(`[data-search="${id}"]`).forEach(i=>channels[i.dataset.ch]=i.checked);const rr=await fetch(`${API}/me/saved-searches/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({notification_channels:channels})});showToast(rr.ok?'تم حفظ قنوات التنبيه':'تعذر حفظ القنوات');});
  m.querySelectorAll('[data-toggle-alert]').forEach(b=>b.onclick=async()=>{const rr=await fetch(`${API}/me/saved-searches/${b.dataset.toggleAlert}`,{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({alerts_enabled:b.dataset.enabled!=='true'})});if(rr.ok){m.remove();openSavedSearches()}});
  m.querySelectorAll('[data-delete-search]').forEach(b=>b.onclick=async()=>{const rr=await fetch(`${API}/me/saved-searches/${b.dataset.deleteSearch}`,{method:'DELETE',credentials:'same-origin'});if(rr.ok){m.remove();openSavedSearches()}});
  m.querySelector('#enablePushBtn')?.addEventListener('click',enablePushNotifications);
}
async function enablePushNotifications(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window)){showToast('المتصفح لا يدعم Push');return}
  try{const reg=await navigator.serviceWorker.register('/service-worker.js');const rr=await fetch(`${API}/me/push/public-key`,{credentials:'same-origin'});const key=await rr.json();if(!rr.ok)throw Error(key.error||'Push غير مهيأ');const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(key.publicKey)});const sr=await fetch(`${API}/me/push/subscribe`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({subscription:sub.toJSON()})});if(!sr.ok)throw Error('تعذر تسجيل الجهاز');showToast('تم تفعيل إشعارات Push على هذا الجهاز');}catch(e){showToast(e.message||'تعذر تفعيل Push')}
}
function urlBase64ToUint8Array(base64String){const padding='='.repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
async function openNotifications(){
  if(!currentUser){openAuth();return}
  const r=await fetch(`${API}/me/notifications`,{credentials:'same-origin'}); const j=await r.json();
  const rows=(j.data||[]).map(x=>`<div class="account-card" style="opacity:${x.is_read?'.65':'1'}"><b>${escapeHtml(x.title)}</b><span>${escapeHtml(x.body)}</span><small>${new Date(x.created_at).toLocaleString('ar')}</small>${x.property_id?`<button data-open-notify="${x.property_id}" data-notify-id="${x.id}">عرض العقار</button>`:''}</div>`).join('')||'<p>لا توجد تنبيهات.</p>';
  const m=modalHtml('notificationsModal','<h2>التنبيهات داخل التطبيق</h2>',rows); await fetch(`${API}/me/notifications/read`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:'{}'}); m.querySelectorAll('[data-open-notify]').forEach(b=>b.onclick=()=>location.href=`/property.html?id=${b.dataset.openNotify}`);
}
function openUserAccount(){const m=modalHtml('accountModal',`<h2>حسابي</h2><p>مرحباً ${escapeHtml(currentUser.name)}</p>`,`<div class="account-card"><b>${escapeHtml(currentUser.email)}</b><span>${escapeHtml(currentUser.phone||'لا يوجد رقم هاتف')}</span><small>نوع الحساب: ${currentUser.role==='admin'?'مدير':currentUser.role==='agent'?'مكتب عقاري':'مستخدم'}</small></div><button id="myProps">عقاراتي</button><button id="savedSearchesBtn">🔔 عمليات البحث المحفوظة</button><button id="notificationsBtn">🔔 التنبيهات</button><button id="logoutBtn">تسجيل الخروج</button>${currentUser.role==='admin'?'<button id="adminBtn">لوحة الإدارة</button>'+(!Array.isArray(currentUser.admin_permissions)||currentUser.admin_permissions.includes('offers.read')?'<button id="reviewOffersBtn">مراجعة العروض وعروض المكاتب</button>':''):''}`);if(m.querySelector('#reviewOffersBtn'))m.querySelector('#reviewOffersBtn').onclick=()=>location.href='/offer-review.html';if(m.querySelector('#adminBtn'))m.querySelector('#adminBtn').onclick=()=>location.href='/admin.html';m.querySelector('#savedSearchesBtn').onclick=()=>{m.remove();openSavedSearches()};m.querySelector('#notificationsBtn').onclick=()=>{m.remove();openNotifications()};m.querySelector('#logoutBtn').onclick=async()=>{await fetch(`${API}/auth/logout`,{method:'POST',credentials:'same-origin'});currentUser=null;favorites.clear();updateAuthUI();m.remove();document.querySelector('#fav span').textContent='0';showToast('تم تسجيل الخروج')};m.querySelector('#myProps').onclick=()=>{m.remove();openAccount()}}

// Search / navigation
document.getElementById('saveSearchBtn')?.addEventListener('click',saveCurrentSearch);if('serviceWorker' in navigator)navigator.serviceWorker.register('/service-worker.js').catch(()=>{});loadProperties();me();
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{if(t.dataset.mode==='sell'){openProperty();return}document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');currentMode=t.dataset.mode;refreshGeoSearch()});
for(const [selector,mode] of [['a[href="#rent"]','إيجار'],['a[data-sale-link]','بيع']])document.querySelectorAll(selector).forEach(link=>link.onclick=e=>{e.preventDefault();document.querySelector(`.tab[data-mode="${mode}"]`).click();document.getElementById('listings').scrollIntoView({behavior:'smooth'});});
document.getElementById('search').onsubmit=async e=>{e.preventDefault();const q=new URLSearchParams({mode:currentMode,currency:displayCurrency});const city=document.getElementById('city').value,type=document.getElementById('type').value,min=document.getElementById('min').value,max=document.getElementById('max').value,rooms=document.getElementById('rooms').value;if(city)q.set('city',city);if(type)q.set('type',type);if(min)q.set('minPrice',min);if(max)q.set('maxPrice',max);if(rooms)q.set('rooms',rooms);await loadProperties(q.toString(),'search');document.getElementById('resultNote').textContent=`تم العثور على ${properties.length} إعلانًا مطابقًا.`;document.getElementById('listings').scrollIntoView({behavior:'smooth'})};
document.querySelectorAll('.categories button[data-type]').forEach(b=>b.onclick=()=>{document.getElementById('type').value=b.dataset.type;loadProperties(`type=${encodeURIComponent(b.dataset.type)}&mode=${encodeURIComponent(currentMode)}`,'search')});document.querySelectorAll('.citygrid button').forEach(b=>b.onclick=()=>{const city=document.getElementById('city');city.value=b.dataset.city;city.dispatchEvent(new Event('change'));loadProperties(`city=${encodeURIComponent(b.dataset.city)}`,'search')});document.getElementById('all').onclick=e=>{e.preventDefault();currentMode='';document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.mode===''));document.getElementById('officeFilter').value='';document.getElementById('availabilityFilter').value='unconfirmed';['type','min','max','rooms'].forEach(id=>document.getElementById(id).value='');document.getElementById('city').value='';document.getElementById('city').dispatchEvent(new Event('change'));loadProperties('', 'search')};document.getElementById('fav').onclick=()=>{if(!currentUser)return openAuth();render(properties.filter(p=>favorites.has(Number(p.id))))};
// Keep the mobile menu compact and dismiss it whenever the visitor returns to the page.
(() => {
  const button = document.getElementById('menu');
  const navigation = document.getElementById('siteNav');
  const mobile = window.matchMedia('(max-width: 800px)');
  const setOpen = open => {
    navigation.classList.toggle('mobile-open', open && mobile.matches);
    button.setAttribute('aria-expanded', String(open && mobile.matches));
  };
  const close = () => setOpen(false);
  button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) close();
  });
  const closeOutside = event => {
    if (!navigation.contains(event.target) && !button.contains(event.target)) close();
  };
  document.addEventListener('pointerdown', closeOutside);
  document.addEventListener('focusin', closeOutside);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      close();
      button.focus();
    }
  });
  ['pageshow', 'pagehide', 'popstate', 'hashchange'].forEach(name => window.addEventListener(name, close));
  mobile.addEventListener('change', close);
})();

function openProperty(fromDashboard=false) {
  const existing = document.getElementById('propertyModal');
  if (existing?.classList.contains('open')) { existing.querySelector('.modalbox').focus(); return existing; }
  const m = modalHtml('propertyModal', '<h2>أضف عقارك</h2><p>أرفق الصور والفيديو، ثم أكمل بيانات الإعلان.</p>', `
    <form id="property" class="edit-form">
      <section id="propertyAttachments" class="property-attachments full" aria-label="صور وفيديو الإعلان"></section>
      <input name="title" required placeholder="عنوان الإعلان">
      <select name="type" required aria-label="نوع العقار"><option value="">نوع العقار</option><option>شقة</option><option>منزل</option><option>فيلا</option><option>أرض</option><option>محل تجاري</option><option>مكتب</option><option>بناء</option><option>مزرعة</option></select>
      <select name="mode" aria-label="نوع العملية"><option>بيع</option><option>إيجار</option></select>
      <input name="city" required placeholder="المدينة"><input name="district" placeholder="المنطقة">
      <input name="price" required type="number" min="0" placeholder="السعر">
      <label>عملة السعر<select name="currency">${['USD','SYP','SAR','EUR','AED','GBP','KWD','QAR','CAD','AUD','JPY','CHF','SGD'].map(currency => `<option>${currency}</option>`).join('')}</select></label>
      <input name="area" type="number" min="0" placeholder="المساحة م²">
      <input name="rooms" type="number" min="0" placeholder="غرف النوم"><input name="baths" type="number" min="0" placeholder="دورات المياه">
      <textarea class="full" name="description" placeholder="وصف العقار"></textarea>
      <details class="property-location full"><summary>تحديد موقع العقار على الخريطة (اختياري)</summary>
        <div id="newPropertyMap" class="location-picker"></div>
        <div class="location-fields"><input name="latitude" placeholder="خط العرض"><input name="longitude" placeholder="خط الطول"></div>
        <small>اضغط على الخريطة لتحديد الموقع، أو اتركه فارغًا.</small>
      </details>
      <p id="propertySaveStatus" class="property-save-status full" role="status" aria-live="polite">${currentUser ? 'سيتم نشر الإعلان باسم حسابك.' : 'يمكنك تجهيز الإعلان الآن. يلزم تسجيل الدخول لحفظه.'}</p>
      <progress id="propertyUploadProgress" class="full" max="100" value="0" hidden aria-label="تقدم رفع الملف"></progress>
      <button id="saveProperty" type="submit" class="primary full">حفظ الإعلان ورفع المرفقات</button>
      <button id="finishProperty" type="button" class="media-finish full" hidden>متابعة بالإعلان المحفوظ</button>
    </form>`);
  const form = m.querySelector('#property');
  const media = PropertyMedia.create(m.querySelector('#propertyAttachments'));
  const status = m.querySelector('#propertySaveStatus');
  const progress = m.querySelector('#propertyUploadProgress');
  const save = m.querySelector('#saveProperty');
  const finishButton = m.querySelector('#finishProperty');
  let propertyId = null, busy = false, propertyMap = null;
  const locationPanel = m.querySelector('.property-location');
  locationPanel.addEventListener('toggle', () => {
    if (!locationPanel.open || typeof L === 'undefined') return;
    if (!propertyMap) {
      propertyMap = L.map(m.querySelector('#newPropertyMap')).setView([35,38],6);
      addPropertyBasemaps(propertyMap);
      let marker;
      propertyMap.on('click', event => {
        if (busy || propertyId) return;
        form.elements.latitude.value = event.latlng.lat.toFixed(7);
        form.elements.longitude.value = event.latlng.lng.toFixed(7);
        if (marker) marker.setLatLng(event.latlng); else marker = L.marker(event.latlng).addTo(propertyMap);
      });
    }
    propertyMap.invalidateSize();
  });
  const cleanup = () => { media.destroy(); if (propertyMap) { propertyMap.remove(); propertyMap = null; } };
  const close = () => {
    if (busy) { status.textContent = 'جارٍ الحفظ والرفع، انتظر حتى تكتمل العملية.'; return; }
    cleanup(); m.remove();
    if (fromDashboard) document.getElementById('dashboardModal')?.classList.add('open');
  };
  m.querySelector('.modalclose').onclick = close;
  m.onclick = event => { if (event.target === m) close(); };
  const modalKeys = m.onkeydown;
  m.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } else modalKeys(event); };
  async function finish(message) {
    cleanup(); m.remove();
    showToast(message);
    try { if (fromDashboard) dashboardModal(await dashboardData()); else await loadProperties(); }
    catch (_) { showToast(message + ' — حدّث الصفحة لعرضه.'); }
  }
  finishButton.onclick = () => finish('تم حفظ الإعلان بالمرفقات التي اكتمل رفعها. يمكنك إضافة البقية من «الصور والفيديو».');
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    if (!currentUser) { status.textContent = 'سجّل الدخول، ثم اضغط حفظ الإعلان. ستبقى بياناتك ومرفقاتك هنا.'; openAuth(); return; }
    const payload = Object.fromEntries(new FormData(form));
    busy = true; finishButton.hidden = true; save.disabled = true; save.textContent = 'جارٍ الحفظ...';
    status.classList.remove('media-error');
    form.querySelectorAll('input,select,textarea').forEach(input => input.disabled = true);
    try {
      if (!propertyId) {
        status.textContent = 'جارٍ حفظ بيانات الإعلان...';
        const response = await fetch(`${API}/properties`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify(payload) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'تعذر حفظ الإعلان. أعد المحاولة.');
        propertyId = result.data.id;
        media.lock();
      }
      progress.hidden = !media.count;
      const remaining = await media.upload(propertyId, (item, percent) => {
        progress.value = percent;
        status.textContent = `رفع ${item.file.name}: ${percent}%`;
      });
      if (remaining.length) {
        status.classList.add('media-error');
        status.textContent = `تم حفظ الإعلان، وتعذر رفع ${remaining.length} من المرفقات. اضغط إعادة الرفع للمحاولة مجددًا.`;
        save.textContent = 'إعادة رفع الملفات المتبقية';
        finishButton.hidden = false;
      } else {
        await finish(media.count ? 'تم حفظ الإعلان ورفع الصور والفيديو بنجاح.' : 'تم حفظ الإعلان بنجاح.');
      }
    } catch (error) {
      status.classList.add('media-error');
      status.textContent = error.message || 'تعذر الاتصال. أعد المحاولة.';
      save.textContent = propertyId ? 'إعادة رفع الملفات المتبقية' : 'حفظ الإعلان ورفع المرفقات';
      if (propertyId) finishButton.hidden = false;
    } finally {
      busy = false; save.disabled = false; progress.hidden = true;
      if (!propertyId) form.querySelectorAll('input,select,textarea').forEach(input => input.disabled = false);
    }
  };
  return m;
}
document.getElementById('addBtn').onclick=()=>openProperty();
document.querySelectorAll('a[href="#add"]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();openProperty();}));
window.addEventListener('load',()=>{if(location.hash==='#add')openProperty();});

// ==================== Owner / Agent Dashboard ====================
async function dashboardData(){const r=await fetch(`${API}/me/dashboard`,{credentials:'same-origin'});if(!r.ok){const j=await r.json().catch(()=>({}));throw Error(j.error||'تعذر تحميل لوحة التحكم');}return r.json()}
function roleLabel(r){return r==='agent'?'مكتب عقاري':r==='admin'?'مدير':'مالك عقار'}
function dashboardModal(data){
  const m=modalHtml('dashboardModal','',`<div class="dashboard"><div class="dash-head"><div><h2>لوحة التحكم</h2><p>مرحباً ${escapeHtml(data.user.name)} — ${roleLabel(data.user.role)}</p></div><div class="dash-actions"><button class="primary" id="dashAdd">＋ إضافة عقار</button></div></div><div class="dash-tabs"><button class="active" data-dtab="overview">نظرة عامة</button><button data-dtab="properties">عقاراتي</button><button data-dtab="inquiries">الاستفسارات</button><button data-dtab="profile">حسابي</button></div><div id="dashContent"></div></div>`);
  const content=m.querySelector('#dashContent');
  function renderTab(tab){
    m.querySelectorAll('[data-dtab]').forEach(b=>b.classList.toggle('active',b.dataset.dtab===tab));
    if(tab==='overview') content.innerHTML=`<div class="dash-stats"><div class="dash-stat"><b>${data.stats.properties}</b><span>إجمالي العقارات</span></div><div class="dash-stat"><b>${data.stats.views}</b><span>إجمالي المشاهدات</span></div><div class="dash-stat"><b>${data.stats.inquiries}</b><span>إجمالي الاستفسارات</span></div><div class="dash-stat"><b>${data.properties.filter(p=>Number(p.new_inquiries)>0).length}</b><span>عقارات لديها استفسارات جديدة</span></div></div><h3>آخر العقارات</h3>${propertyTable(data.properties.slice(0,5))}`;
    if(tab==='properties') content.innerHTML=`<div class="dash-actions" style="margin-bottom:12px"><button class="primary" id="dashAdd2">＋ إضافة عقار جديد</button></div>${propertyTable(data.properties)}`;
    if(tab==='inquiries') content.innerHTML=data.inquiries.length?data.inquiries.map(i=>`<div class="inquiry"><div class="inquiry-head"><b>${escapeHtml(i.sender_name)} — ${escapeHtml(i.title)}</b><span class="status ${i.status}">${i.status==='new'?'جديد':i.status==='read'?'مقروء':i.status==='replied'?'تم الرد':'مغلق'}</span></div><div style="font-size:12px;color:#697688;margin:7px 0">${escapeHtml(i.sender_phone||'')} ${i.sender_email?' · '+escapeHtml(i.sender_email):''}</div><div>${escapeHtml(i.message)}</div><div class="actions" style="margin-top:10px"><button data-status="read" data-iid="${i.id}">مقروء</button><button data-status="replied" data-iid="${i.id}">تم الرد</button><button data-status="closed" data-iid="${i.id}">إغلاق</button></div></div>`).join(''):'<div class="empty-state">لا توجد استفسارات بعد.</div>';
    if(tab==='profile') content.innerHTML=`<div class="account-card"><b>${escapeHtml(data.user.name)}</b><span>${escapeHtml(data.user.email)}</span><span>${escapeHtml(data.user.phone||'لا يوجد رقم هاتف')}</span><small>نوع الحساب: ${roleLabel(data.user.role)}</small><small>تاريخ التسجيل: ${new Date(data.user.created_at).toLocaleDateString('ar-SY')}</small></div>`;
    bindDashboardEvents();
  }
  function propertyTable(list){if(!list.length)return '<div class="empty-state">لم تضف أي عقار حتى الآن.</div>';return `<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>العقار</th><th>المدينة</th><th>السعر</th><th>المشاهدات</th><th>الاستفسارات</th><th>الصور</th><th>إجراءات</th></tr></thead><tbody>${list.map(p=>`<tr><td><b>${escapeHtml(p.title)}</b><br><small>${escapeHtml(p.type)} · ${escapeHtml(p.mode)}</small></td><td>${escapeHtml(p.city)}<br><small>${escapeHtml(p.district||'')}</small></td><td>${money(p.price)}</td><td>${p.views_count||0}</td><td>${p.new_inquiries||0}</td><td><div class="thumbs">${(p.images||[]).slice(0,4).map(im=>`<img class="thumb" src="${escapeHtml(im.url)}">`).join('')||'—'}</div></td><td><div class="actions"><button data-edit="${p.id}">تعديل</button><button data-studio="${p.id}">✨ AI Studio</button><button data-images="${p.id}">الصور والفيديو</button><button class="danger" data-delete="${p.id}">حذف</button></div></td></tr>`).join('')}</tbody></table></div>`}
  async function bindDashboardEvents(){
    m.querySelectorAll('[data-dtab]').forEach(b=>b.onclick=()=>renderTab(b.dataset.dtab));
    m.querySelector('#dashAdd')?.addEventListener('click',()=>{m.classList.remove('open');openProperty(true)});m.querySelector('#dashAdd2')?.addEventListener('click',()=>{m.classList.remove('open');openProperty(true)});
    m.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('هل أنت متأكد من حذف العقار؟'))return;const r=await fetch(`${API}/me/properties/${b.dataset.delete}`,{method:'DELETE',credentials:'same-origin'});const j=await r.json();if(!r.ok)return showToast(j.error);showToast('تم حذف العقار');const fresh=await dashboardData();m.remove();dashboardModal(fresh);});
    m.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const p=data.properties.find(x=>String(x.id)===b.dataset.edit);openEditProperty(p,m)});
    m.querySelectorAll('[data-images]').forEach(b=>b.onclick=()=>{const p=data.properties.find(x=>String(x.id)===b.dataset.images);openImagesManager(p,m)});
    m.querySelectorAll('[data-status]').forEach(b=>b.onclick=async()=>{const r=await fetch(`${API}/me/inquiries/${b.dataset.iid}`,{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({status:b.dataset.status})});if(r.ok){const fresh=await dashboardData();m.remove();dashboardModal(fresh);}});
  }
  renderTab('overview');
  return m;
}

async function openAccount(){ if(currentUser?.role==='agent'){ location.href='/office.html'; return; } try{const data=await dashboardData();dashboardModal(data)}catch(e){showToast(e.message)} }

function openEditProperty(p,parent){
  const m=modalHtml('editPropertyModal','<h2>تعديل العقار</h2><p>حدّث بيانات الإعلان ثم احفظ التغييرات.</p>',`<form id="editPropertyForm" class="edit-form"><input name="title" required placeholder="العنوان" value="${escapeHtml(p.title)}"><select name="type"><option ${p.type==='شقة'?'selected':''}>شقة</option><option ${p.type==='منزل'?'selected':''}>منزل</option><option ${p.type==='فيلا'?'selected':''}>فيلا</option><option ${p.type==='أرض'?'selected':''}>أرض</option><option ${p.type==='محل تجاري'?'selected':''}>محل تجاري</option><option ${p.type==='مكتب'?'selected':''}>مكتب</option><option ${p.type==='بناء'?'selected':''}>بناء</option><option ${p.type==='مزرعة'?'selected':''}>مزرعة</option></select><select name="mode"><option ${p.mode==='بيع'?'selected':''}>بيع</option><option ${p.mode==='إيجار'?'selected':''}>إيجار</option></select><input name="city" required placeholder="المدينة" value="${escapeHtml(p.city)}"><input name="district" placeholder="المنطقة" value="${escapeHtml(p.district||'')}"><input name="price" type="number" required placeholder="السعر" value="${p.price}"><label>عملة السعر<select name="currency"><option >USD</option><option >SYP</option><option >SAR</option><option >EUR</option><option >AED</option><option >GBP</option><option >KWD</option><option >QAR</option><option >CAD</option><option >AUD</option><option >JPY</option><option >CHF</option><option >SGD</option></select></label><input name="area" type="number" placeholder="المساحة" value="${p.area||''}"><input name="rooms" type="number" placeholder="الغرف" value="${p.rooms||''}"><input name="baths" type="number" placeholder="الحمامات" value="${p.baths||''}"><textarea class="full" name="description" placeholder="الوصف">${escapeHtml(p.description||'')}</textarea><div class="full"><b>موقع العقار على الخريطة</b><div id="editPropertyMap" class="location-picker"></div><div class="location-fields"><input id="editLat" name="latitude" placeholder="خط العرض" value="${p.latitude??''}"><input id="editLng" name="longitude" placeholder="خط الطول" value="${p.longitude??''}"></div><small>اضغط على الخريطة لتحديد موقع العقار بدقة.</small></div><button class="primary full">حفظ التغييرات</button></form>`);
  const currencySelect=m.querySelector('select[name=currency]'); if(currencySelect) currencySelect.value=p.currency||'USD';
  if(typeof L!=='undefined'){const em=m.querySelector('#editPropertyMap');const emap=L.map(em).setView([Number(p.latitude)||33.5138,Number(p.longitude)||36.2765],p.latitude&&p.longitude?15:6);addPropertyBasemaps(emap);let emarker=(p.latitude&&p.longitude)?L.marker([Number(p.latitude),Number(p.longitude)]).addTo(emap):null;emap.on('click',e=>{m.querySelector('#editLat').value=e.latlng.lat.toFixed(7);m.querySelector('#editLng').value=e.latlng.lng.toFixed(7);if(emarker)emarker.setLatLng(e.latlng);else emarker=L.marker(e.latlng).addTo(emap);});setTimeout(()=>emap.invalidateSize(),100);}
  m.querySelector('#editPropertyForm').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));const r=await fetch(`${API}/me/properties/${p.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(data)});const j=await r.json();if(!r.ok)return showToast(j.error);m.remove();parent?.remove();dashboardModal(await dashboardData());showToast('تم تعديل العقار بنجاح')}
}
function openImagesManager(p,parent){
  const images=p.images||[], videos=p.videos||[];
  const m=modalHtml('mediaModal','<h2>صور وفيديو العقار</h2><p>الصور: حتى 12 صورة، 8MB للصورة. الفيديو: حتى 3 مقاطع، 100MB للمقطع (MP4 / WebM / MOV).</p>',`<h3>الصور</h3><div class="thumbs" style="margin-bottom:12px">${images.map(im=>`<div style="position:relative"><img class="thumb" style="width:100px;height:75px" src="${escapeHtml(im.url)}"><button data-delimg="${im.id}" style="position:absolute;top:1px;left:1px">×</button></div>`).join('')||'<span>لا توجد صور بعد.</span>'}</div><div class="image-upload" style="margin-bottom:20px"><input id="imagesInput" type="file" accept="image/jpeg,image/png,image/webp" multiple><button class="primary" id="uploadImages">رفع الصور</button></div><h3>مقاطع الفيديو</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px">${videos.map(v=>`<div style="position:relative;background:#111;border-radius:8px;overflow:hidden">${v.source_type==='youtube'?`<img src="https://i.ytimg.com/vi/${encodeURIComponent(youtubeId(v.url))}/hqdefault.jpg" style="width:100%;height:120px;object-fit:cover">`:`<video src="${escapeHtml(v.url)}" controls style="width:100%;height:120px;object-fit:cover"></video>`}<div style="padding:6px;color:#fff;font-size:11px">${escapeHtml(v.title||'فيديو العقار')} ${v.is_primary?'⭐ رئيسي':''}</div><div style="display:flex;gap:5px;padding:6px"><button data-primaryvideo="${v.id}">${v.is_primary?'الفيديو الرئيسي':'تعيين كرئيسي'}</button><button data-delvideo="${v.id}">×</button></div></div>`).join('')||'<span>لا توجد مقاطع فيديو بعد.</span>'}</div><div class="image-upload"><input id="videosInput" type="file" accept="video/mp4,video/webm,video/quicktime" multiple><button class="primary" id="uploadVideos">رفع الفيديو</button></div><div style="margin-top:18px;padding:14px;border:1px solid #ddd;border-radius:10px"><h4 style="margin:0 0 10px">إضافة فيديو من يوتيوب أو رابط خارجي</h4><input id="externalVideoUrl" placeholder="https://www.youtube.com/watch?v=... أو رابط فيديو مباشر" style="width:100%;margin-bottom:8px"><input id="externalVideoTitle" placeholder="عنوان الفيديو (اختياري)" style="width:100%;margin-bottom:8px"><button class="primary" id="addExternalVideo">إضافة الرابط</button></div>`);
  m.querySelector('#uploadImages').onclick=async()=>{const files=m.querySelector('#imagesInput').files;if(!files.length)return showToast('اختر صورة واحدة على الأقل');const fd=new FormData();[...files].slice(0,12).forEach(f=>fd.append('images',f));const r=await fetch(`${API}/me/properties/${p.id}/images`,{method:'POST',body:fd,credentials:'same-origin'});const j=await r.json();if(!r.ok)return showToast(j.error);m.remove();parent?.remove();dashboardModal(await dashboardData());showToast(`تم رفع ${j.data.length} صورة`)};
  m.querySelector('#uploadVideos').onclick=async()=>{const files=m.querySelector('#videosInput').files;if(!files.length)return showToast('اختر فيديو واحداً على الأقل');const fd=new FormData();[...files].slice(0,3).forEach(f=>fd.append('videos',f));const r=await fetch(`${API}/me/properties/${p.id}/videos`,{method:'POST',body:fd,credentials:'same-origin'});const j=await r.json();if(!r.ok)return showToast(j.error||'تعذر رفع الفيديو');m.remove();parent?.remove();dashboardModal(await dashboardData());showToast(`تم رفع ${j.data.length} فيديو`)};
  m.querySelectorAll('[data-delimg]').forEach(b=>b.onclick=async()=>{const r=await fetch(`${API}/me/properties/${p.id}/images/${b.dataset.delimg}`,{method:'DELETE',credentials:'same-origin'});if(r.ok){m.remove();parent?.remove();dashboardModal(await dashboardData());showToast('تم حذف الصورة')}});
  m.querySelector('#addExternalVideo').onclick=async()=>{const url=m.querySelector('#externalVideoUrl').value.trim();const title=m.querySelector('#externalVideoTitle').value.trim();if(!url)return showToast('أدخل رابط الفيديو');const r=await fetch(`${API}/me/properties/${p.id}/external-videos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,title}),credentials:'same-origin'});const j=await r.json();if(!r.ok)return showToast(j.error||'تعذر إضافة الرابط');m.remove();parent?.remove();dashboardModal(await dashboardData());showToast('تمت إضافة رابط الفيديو')};m.querySelectorAll('[data-primaryvideo]').forEach(b=>b.onclick=async()=>{const r=await fetch(`${API}/me/properties/${p.id}/videos/${b.dataset.primaryvideo}/primary`,{method:'PATCH',credentials:'same-origin'});if(r.ok){m.remove();parent?.remove();dashboardModal(await dashboardData());showToast('تم تعيين الفيديو الرئيسي')}});m.querySelectorAll('[data-delvideo]').forEach(b=>b.onclick=async()=>{const r=await fetch(`${API}/me/properties/${p.id}/videos/${b.dataset.delvideo}`,{method:'DELETE',credentials:'same-origin'});if(r.ok){m.remove();parent?.remove();dashboardModal(await dashboardData());showToast('تم حذف الفيديو')}});
}

window.addEventListener('load',()=>initGeoMap());

setupCurrency();

// V40 personalized recommendations
function recommendationCard(p){const img=p.image_url?`<div class="card-main-video" style="background-image:url('${escapeHtml(p.image_url)}');background-size:cover;background-position:center"></div>`:(kindFor(p.type)==='land'?'<div class="land"></div>':kindFor(p.type)==='villa'?'<div class="villa"></div>':'<div class="building"></div>');return `<article class="property-card rec-card" data-rec="${p.id}"><div class="property-image ${kindFor(p.type)}"><span class="badge">${p.personal_score}% مناسب</span>${img}<span class="price">${money(p.price,p.currency||'USD')}</span></div><div class="card-body"><h3>${escapeHtml(p.title)}</h3><div class="location">⌖ ${escapeHtml(p.city)} - ${escapeHtml(p.district||'')}</div><div class="meta"><span>▦ ${p.area?p.area+' م²':'—'}</span><span>🛏 ${p.rooms??'—'}</span></div><small style="display:block;margin-top:8px;color:#617083">${escapeHtml(p.recommendation_reason||'مقترح لك')}</small><button type="button" data-dismiss-rec="${p.id}" style="margin-top:8px">لا يناسبني</button></div></article>`}
async function loadRecommendations(){const sec=document.getElementById('forYou'),grid=document.getElementById('recommendationCards'),note=document.getElementById('recommendationNote');if(!sec||!currentUser){if(sec)sec.style.display='none';return}try{const r=await fetch(`${API}/me/recommendations?limit=8`,{credentials:'same-origin'});const j=await r.json();if(!r.ok)throw Error(j.error);sec.style.display='block';grid.innerHTML=(j.data||[]).map(recommendationCard).join('')||'<div class="empty-state">لا توجد اقتراحات جديدة حالياً.</div>';note.textContent=j.cold_start?'كلما شاهدت وحفظت وتواصلت بشأن عقارات أكثر، تصبح الاقتراحات أدق.':`تم بناء الاقتراحات من ${j.profile?.signal_count||0} إشارة اهتمام — ثقة الملف ${j.profile?.confidence||0}%.`;grid.querySelectorAll('[data-rec]').forEach(c=>c.onclick=async e=>{if(e.target.closest('[data-dismiss-rec]'))return;fetch(`${API}/me/property-events/${c.dataset.rec}`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({event_type:'recommendation_click'})}).catch(()=>{});location.href='/property.html?id='+encodeURIComponent(c.dataset.rec)});grid.querySelectorAll('[data-dismiss-rec]').forEach(b=>b.onclick=async e=>{e.stopPropagation();await fetch(`${API}/me/property-events/${b.dataset.dismissRec}`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({event_type:'dismiss'})});b.closest('.property-card')?.remove()})}catch(e){sec.style.display='none'}}
document.getElementById('refreshRecommendations')?.addEventListener('click',async()=>{await fetch(`${API}/me/recommendations/rebuild`,{method:'POST',credentials:'same-origin'});loadRecommendations()});
setTimeout(()=>loadRecommendations(),1200);

// Sol runs locally at /sol.html; chat text is never sent by this page.

// V71 — AI Listing Studio
async function openListingStudio(propertyId){
  const m=modalHtml('listingStudioModal','<h2>✨ AI Listing Studio</h2><p>ينشئ محتوى تسويقياً من بيانات العقار، ثم تختار أنت ما إذا كنت تريد تطبيقه.</p>',`<div id="studioBody"><div class="empty-state">اضغط لإنشاء مسودة احترافية.</div><button class="primary" id="studioGenerate">إنشاء المحتوى بالذكاء الاصطناعي</button></div>`);
  const body=m.querySelector('#studioBody');
  m.querySelector('#studioGenerate').onclick=async()=>{
    body.innerHTML='<div class="empty-state">جارٍ إنشاء العنوان والوصف وSEO والنصوص التسويقية…</div>';
    try{
      const r=await fetch(`${API}/listing-studio/${propertyId}/generate`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:'{}'});const j=await r.json();if(!r.ok)throw Error(j.error||'تعذر الإنشاء');const d=j.data;
      body.innerHTML=`<div class="edit-form"><label class="full">العنوان المقترح<input id="studioTitle" value="${escapeHtml(d.title||'')}"></label><label class="full">الوصف المقترح<textarea id="studioDesc" rows="7">${escapeHtml(d.description||'')}</textarea></label><div class="full"><b>المميزات</b><p>${(d.features||[]).map(escapeHtml).join(' • ')||'—'}</p></div><div class="full"><b>SEO</b><p>${escapeHtml(d.seo?.meta_title||'')}</p><small>${escapeHtml(d.seo?.meta_description||'')}</small></div><label class="full">WhatsApp<textarea rows="4" readonly>${escapeHtml(d.social?.whatsapp||'')}</textarea></label><label class="full">Instagram<textarea rows="5" readonly>${escapeHtml(d.social?.instagram||'')}</textarea></label><label class="full">إعلان مدفوع<textarea rows="3" readonly>${escapeHtml(d.social?.paid_ad||'')}</textarea></label><div class="full notice">لن يتم تعديل الإعلان إلا بعد موافقتك الصريحة.</div><button class="primary full" id="studioApply">اعتماد العنوان والوصف</button></div>`;
      body.querySelector('#studioApply').onclick=async()=>{if(!confirm('هل تريد تحديث عنوان ووصف العقار بهذه المسودة؟'))return;const out={...d,title:body.querySelector('#studioTitle').value,description:body.querySelector('#studioDesc').value};/* edits remain preview-only in V71; server applies stored audited draft */const ar=await fetch(`${API}/listing-studio/${propertyId}/apply`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({generation_id:d.id,confirmation:'أوافق على تحديث الإعلان'})});const aj=await ar.json();if(!ar.ok)return showToast(aj.error);showToast('تم تحديث الإعلان بالمسودة المعتمدة');m.remove();try{dashboardModal(await dashboardData())}catch{loadProperties()}};
    }catch(e){body.innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div><button class="primary" onclick="openListingStudio(${Number(propertyId)})">إعادة المحاولة</button>`}
  };
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-studio]');if(b){e.preventDefault();e.stopPropagation();openListingStudio(b.dataset.studio)}});

async function saveCurrentSearch(){
 if(!currentUser)return openAuth();
 const filters={mode:currentMode,currency:displayCurrency};
 for(const [id,key] of [['city','city'],['district','district'],['type','type'],['min','minPrice'],['max','maxPrice'],['rooms','rooms']]){const value=document.getElementById(id).value.trim();if(value)filters[key]=value;}
 try{const r=await fetch('/api/me/saved-searches',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:[filters.city,filters.district].filter(Boolean).join(' — ')||'بحث عقاري',...filters,currency:displayCurrency})});const j=await r.json();showToast(r.ok?'تم حفظ البحث':j.error||'تعذر حفظ البحث');}catch{showToast('تعذر حفظ البحث');}
}

// Include newly published office offers in the public office selector.
(async function loadOfficeChoices(){try{const response=await fetch('/api/market/office-options');if(!response.ok)return;const json=await response.json(),select=document.getElementById('officeFilter');for(const office of json.data||[]){if([...select.options].some(o=>o.value===office.key))continue;const option=document.createElement('option');option.value=office.key;option.textContent=office.name;select.append(option);}}catch{}})();
