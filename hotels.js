const $=id=>document.getElementById(id);
let selectedSearch={},selectedHotel=null,hotelSearchVersion=0;
const lodgingNames={hotel:'فندق',chalet:'شاليه',farm:'مزرعة للإيجار',furnished_apartment:'شقة مفروشة'};
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function nights(a,b){return (Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000;}
function stayToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Damascus',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function addDays(date,days){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
function dateLabel(date){const d=String(date||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)?new Intl.DateTimeFormat('ar-SY',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z')):'—';}
function money(amount,currency){return Number(amount||0).toLocaleString('en-US',{maximumFractionDigits:2})+' '+esc(currency||'');}
function nightCount(n){n=Number(n);return n===1?'ليلة واحدة':n===2?'ليلتان':n+' '+(n>=3&&n<=10?'ليالٍ':'ليلة');}
function unitCount(n){n=Number(n);return n===1?'وحدة واحدة':n===2?'وحدتان':n+' '+(n>=3&&n<=10?'وحدات':'وحدة');}
function guestCount(n){n=Number(n);return n===1?'ضيف واحد':n===2?'ضيفان':n+' '+(n>=3&&n<=10?'ضيوف':'ضيفًا');}
function amenities(value){if(typeof value==='string'){try{value=JSON.parse(value);}catch{return [value];}}return Array.isArray(value)?value.filter(x=>typeof x==='string'):[];}
function amenityChips(value,limit=6){return amenities(value).slice(0,limit).map(a=>`<span class="amenity">${esc(a)}</span>`).join('');}
async function stayApi(url,options={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 try{const r=await fetch(url,{...options,signal:controller.signal});let j;try{j=await r.json();}catch{throw Error('تعذر قراءة الرد. أعد المحاولة بعد قليل.');}if(!r.ok)throw Object.assign(Error(j.error||'تعذر إكمال الطلب. أعد المحاولة.'),{status:r.status});return j;}
 catch(e){if(e.name==='AbortError')throw Error('انتهت مهلة الاتصال. تحقق من الإنترنت وأعد المحاولة.');if(e instanceof TypeError)throw Error('تعذر الاتصال. تحقق من الإنترنت وأعد المحاولة.');throw e;}finally{clearTimeout(timer);}
}
function toastStay(message){const el=$('stayToast');el.textContent=message;el.hidden=false;clearTimeout(toastStay.timer);toastStay.timer=setTimeout(()=>el.hidden=true,3500);}
function isDemoHotel(h){return String(h?.slug||'').startsWith('aqartkom-demo-hotel-v1-')&&String(h?.name||'').startsWith('تجريبي —');}
function hotelPhotos(h){return MediaGallery.items(h).filter(item=>item.type==='image').map(item=>item.url);}
function hotelPhoto(h){const photos=hotelPhotos(h),cover=ListingCover.url(h);return `<button type="button" class="photo hotel-open-photo" onclick="openHotel(${Number(h.id)})" aria-label="عرض صور وتفاصيل ${esc(h.name)}"><span aria-hidden="true">⌂</span>${cover?`<img src="${esc(cover)}" alt="${esc(h.name)}" loading="lazy" onerror="this.remove()"><span class="photo-count">${photos.length===0?'صورة من الفيديو':photos.length===1?'صورة واحدة':photos.length===2?'صورتان':photos.length+' '+(photos.length<11?'صور':'صورة')}</span>`:''}${isDemoHotel(h)?'<span class="demo-badge">تجريبي — للاختبار فقط</span>':''}</button>`;}
function updateGuestSummary(){const adults=Number($('guests').value)||1,children=Number($('children').value)||0,rooms=Number($('rooms').value)||1;$('guestSummary').textContent=`${guestCount(adults+children)} / وحدة · ${unitCount(rooms)}`;}
function searchSelection(){return {checkIn:$('checkIn').value,checkOut:$('checkOut').value,adults:Number($('guests').value),children:Number($('children').value),rooms:Number($('rooms').value)};}
function stayQuery(s=selectedSearch){return new URLSearchParams(s);}
function updateStayRegion(){
 const city=$('city').value,region=city==='mashta'?'mashta':city==='دمشق'?'damascus':'';
 document.querySelectorAll('[data-stay-region]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.stayRegion===region&& (!!region||!city))));
 const url=new URL(location.href);for(const key of ['region','city','lodging_type','checkIn','checkOut','adults','children','rooms','q'])url.searchParams.delete(key);
 if(region)url.searchParams.set('region',region);else if(city)url.searchParams.set('city',city);
 if($('lodgingType').value)url.searchParams.set('lodging_type',$('lodgingType').value);
 for(const [key,value] of Object.entries(searchSelection()))url.searchParams.set(key,value);
 if($('q').value.trim())url.searchParams.set('q',$('q').value.trim());history.replaceState(history.state,'',url);
}
async function search(){
 const version=++hotelSearchVersion,selection=searchSelection(),status=$('hotelSearchStatus');
 status.textContent='جارٍ التحقق من الأسعار والتوفر…';$('hotels').setAttribute('aria-busy','true');$('count').textContent='';
 try{
  const n=nights(selection.checkIn,selection.checkOut);if(!Number.isInteger(n)||n<=0||n>365||selection.checkIn<stayToday())throw Error('اختر تاريخ مغادرة بعد تاريخ الوصول، لمدة لا تتجاوز سنة ومن تاريخ اليوم.');
  if(!Number.isInteger(selection.adults)||selection.adults<1||selection.adults>20||!Number.isInteger(selection.children)||selection.children<0||selection.children>10||!Number.isInteger(selection.rooms)||selection.rooms<1||selection.rooms>20)throw Error('راجع عدد الضيوف والوحدات.');
  const city=$('city').value,currency=$('currency').value,sort=$('sort').value;
  if(sort==='price'&&!currency)throw Error('اختر عملة من خيارات البحث لترتيب أسعار قابلة للمقارنة.');
  const params=stayQuery(selection);Object.entries({q:$('q').value,city:city==='mashta'?'':city,lodging_type:$('lodgingType').value,currency,sort,minRating:$('minRating').value,maxTotal:currency?$('maxTotal').value:'',amenities:[...document.querySelectorAll('[name=amenity]:checked')].map(el=>el.value).join(',')}).forEach(([k,v])=>params.set(k,v));
  if(city==='mashta')params.set('region','mashta');if($('includeDemo').checked)params.set('includeDemo','true');
  const includeDemo=$('includeDemo').checked;selectedSearch=selection;updateStayRegion();$('guestPicker').open=false;
  $('hotels').innerHTML='<div class="skeleton" aria-hidden="true"></div><div class="skeleton" aria-hidden="true"></div>';
  const j=await stayApi('/api/stays/search?'+params);if(version!==hotelSearchVersion)return;if(!Array.isArray(j.data))throw Error('تعذر تحميل الإقامات. أعد المحاولة.');
  render(j.data.filter(h=>includeDemo||!isDemoHotel(h)),selection);status.textContent='';
  $('searchContext').textContent=city==='mashta'?'إقامتك في مشتى الحلو':city?'إقامتك في '+city:'أماكن لإقامتك القادمة';
  $('resultsNote').textContent=`${dateLabel(selection.checkIn)} — ${dateLabel(selection.checkOut)} · ${nightCount(n)} · ${unitCount(selection.rooms)} · الأسعار للإقامة كاملة`;
 }catch(e){if(version!==hotelSearchVersion)return;$('hotels').innerHTML='<div class="stay-empty"><h3>لم تكتمل عملية البحث</h3><p>راجع الخيارات أو اتصال الإنترنت ثم أعد المحاولة.</p><button type="button" class="outline" onclick="search()">إعادة البحث</button></div>';status.textContent=e.message;}
 finally{if(version===hotelSearchVersion)$('hotels').setAttribute('aria-busy','false');}
}
function render(rows,s=selectedSearch){
 $('count').textContent=rows.length;
 $('hotels').innerHTML=rows.map(h=>`<article class="card">${hotelPhoto(h)}<div class="cardbody"><div class="card-top"><div><span class="meta">${esc(lodgingNames[h.lodging_type]||'إقامة')}</span><h3><button type="button" class="hotel-name" onclick="openHotel(${Number(h.id)})">${esc(h.name)}</button></h3></div>${Number(h.review_count)>0?`<div class="rating"><b>${Number(h.review_score).toFixed(1)}</b><span>${Number(h.review_count)} تقييم<br>من 5</span></div>`:''}</div><div class="meta">${esc(h.city)}${h.district?' · '+esc(h.district):''}</div>${Number(h.star_rating)>0?`<div class="stars" aria-label="${Number(h.star_rating)} نجوم">${'★'.repeat(Math.min(5,Math.round(Number(h.star_rating))))}</div>`:''}<p class="card-description">${esc(h.description||'تعرّف إلى الوحدات وصورها وشروط الإقامة.')}</p><div class="amenities">${amenityChips(h.amenities,3)}</div><div class="card-bottom"><div><div class="price-label">الإقامة كاملة، ابتداءً من</div><div class="price">${money(h.from_total,h.currency)}</div><div class="price-detail">${nightCount(h.nights||nights(s.checkIn,s.checkOut))} · ${unitCount(h.rooms_count||s.rooms)}</div>${Number(h.discount_amount)>0?`<div class="discount">توفير ${money(h.discount_amount,h.currency)} ضمن العرض</div>`:''}</div><button type="button" class="primary" onclick="openHotel(${Number(h.id)})">اختر وحدتك <span aria-hidden="true">←</span></button></div><div data-listing-kind="hotel" data-listing-id="${Number(h.id)}" data-title="${esc(h.name)}"></div></div></article>`).join('')||'<div class="stay-empty"><span class="eyebrow">لنبحث عن خيار آخر</span><h3>لا توجد إقامات متاحة بهذه الخيارات</h3><p>جرّب تواريخ أخرى أو وسّع المنطقة والميزانية.<br>لن تظهر منشأة بلا وحدات متاحة للفترة المطلوبة.</p><button type="button" class="outline" onclick="resetStayFilters()">توسيع خيارات البحث</button></div>';
}
async function openHotel(id){return showHotelDetails(id);}
function resetStayFilters(){$('filters').reset();$('currency').value='';$('maxTotal').disabled=true;$('sort').value='recommended';$('q').value='';$('city').value='';search();}
function adjustDates(a,b){a.min=stayToday();if(a.value){b.min=addDays(a.value,1);if(!b.value||b.value<=a.value)b.value=addDays(a.value,1);}}
const stayParams=new URLSearchParams(location.search);
if(stayParams.get('region')==='mashta')$('city').value='mashta';else if(stayParams.get('region')==='damascus')$('city').value='دمشق';else if(stayParams.get('city'))$('city').value=stayParams.get('city');
if(['hotel','farm','furnished_apartment','chalet'].includes(stayParams.get('lodging_type')))$('lodgingType').value=stayParams.get('lodging_type');
for(const [id,param] of [['guests','adults'],['children','children'],['rooms','rooms'],['q','q']])if(stayParams.has(param))$(id).value=stayParams.get(param);
$('checkIn').value=stayParams.get('checkIn')||addDays(stayToday(),1);$('checkOut').value=stayParams.get('checkOut')||addDays($('checkIn').value||stayToday(),1);adjustDates($('checkIn'),$('checkOut'));
$('checkIn').onchange=()=>adjustDates($('checkIn'),$('checkOut'));['guests','children','rooms'].forEach(id=>$(id).addEventListener('input',updateGuestSummary));updateGuestSummary();
$('applyGuests').onclick=()=>{$('guestPicker').open=false;};
$('hotelSearch').onsubmit=e=>{e.preventDefault();search();};$('filters').onsubmit=e=>{e.preventDefault();search();};$('resetFilters').onclick=resetStayFilters;
$('currency').onchange=()=>{$('maxTotal').disabled=!$('currency').value;if(!$('currency').value)$('maxTotal').value='';$('maxTotal').placeholder=$('currency').value?'ميزانيتك الإجمالية':'اختر العملة أولًا';};
$('sort').onchange=search;$('includeDemo').onchange=search;$('city').onchange=updateStayRegion;
$('myBookings').onclick=showMyBookings;$('close').onclick=closeHotelDetails;
document.querySelectorAll('[data-stay-region]').forEach(b=>b.onclick=()=>{$('city').value=b.dataset.stayRegion==='damascus'?'دمشق':b.dataset.stayRegion;$('q').value='';search();});
if(window.matchMedia?.('(max-width:760px)').matches)document.querySelector('.filter-disclosure').open=false;
selectedSearch=searchSelection();search();const requested=Number(stayParams.get('hotel'));if(Number.isSafeInteger(requested)&&requested>0)openHotel(requested);else handleStayRoute();
function handleStayRoute(){const match=location.hash.match(/^#booking=(AQH-[A-Z0-9]{6,36})$/);if(match)loadBookingReceipt(match[1]);else if(location.hash==='#bookings')showMyBookings();}
window.addEventListener('hashchange',handleStayRoute);
async function loadPublicReviews(id){const box=$('stayReviews');if(!box)return;try{const response=await fetch(`/api/hotels/${id}/reviews`);const d=await response.json();if(!response.ok)throw Error(d.error||'تعذر تحميل التقييمات');if(!box.isConnected)return;box.innerHTML=`<h3>تقييمات الضيوف</h3>${(d.data||[]).map(r=>`<article class="payment-note"><b>${Number(r.rating)} / 5 · ${esc(r.guest_name)}</b>${r.verified_stay?'<small> · إقامة مرتبطة بحجز</small>':''}<h4>${esc(r.title||'')}</h4><p style="white-space:pre-wrap">${esc(r.body)}</p>${r.host_reply?`<p>رد المنشأة: ${esc(r.host_reply)}</p>`:''}</article>`).join('')||'<p>لا توجد تقييمات بعد.</p>'}<div id="reviewFormArea"><p>يمكن للضيف تقييم إقامته بعد المغادرة من الحساب الذي أجرى الحجز.</p></div>`;const eligible=await fetch(`/api/hotels/${id}/review-bookings`);const j=await eligible.json();if(!box.isConnected)return;const area=box.querySelector('#reviewFormArea');if(eligible.status===401){area.innerHTML+=`<a href="/host-portal.html?return_to=${encodeURIComponent('/hotels.html?hotel='+id)}">تسجيل الدخول أو إنشاء حساب</a>`;return;}if(!eligible.ok)throw Error(j.error||'تعذر تحميل حجوزاتك');if(!j.data.length){area.innerHTML+='<p>لا توجد إقامة انتهت ومؤهلة لتقييم جديد في حسابك لهذه المنشأة.</p>';return;}area.innerHTML=`<h4>قيّم إقامتك</h4><form id="stayReviewForm" class="booking"><label>الإقامة<select name="booking_id">${j.data.map(b=>`<option value="${b.id}">${esc(b.booking_code)} · ${esc(String(b.check_out).slice(0,10))}</option>`).join('')}</select></label><label>التقييم<select name="rating"><option value="5">5 — ممتاز</option><option value="4">4 — جيد جدًا</option><option value="3">3 — جيد</option><option value="2">2 — مقبول</option><option value="1">1 — ضعيف</option></select></label><input name="title" maxlength="180" placeholder="عنوان التقييم (اختياري)"><textarea name="body" minlength="3" maxlength="2000" required placeholder="صف تجربتك"></textarea><button>نشر التقييم</button><p id="reviewError" role="alert"></p></form>`;area.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,button=f.querySelector('button');button.disabled=true;try{const r=await fetch(`/api/hotels/${id}/reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f)))});const result=await r.json();if(!r.ok)throw Error(result.error||'تعذر نشر التقييم');await loadPublicReviews(id);}catch(error){f.querySelector('#reviewError').textContent=error.message;button.disabled=false;}};}catch(e){if(box.isConnected)box.insertAdjacentHTML('beforeend',`<p role="alert">${esc(e.message)}</p>`);}}
