// Pending submissions keep their original key and body through retries and reloads.
let bookingFlight=false,checkoutDraft=null;
const stayMemory={};
function nativeStayApp(){return Number(navigator.userAgent.match(/AqartkomNative\/(\d+)/)?.[1]||0)>=170;}
function stayRead(key,fallback){
 try{const storage=nativeStayApp()?localStorage:sessionStorage;const saved=storage.getItem('aq-stay-'+key);if(saved)return JSON.parse(saved);
  if(nativeStayApp()){const earlier=sessionStorage.getItem('aq-stay-'+key);if(earlier){storage.setItem('aq-stay-'+key,earlier);sessionStorage.removeItem('aq-stay-'+key);return JSON.parse(earlier);}}
 }catch{}return stayMemory[key]??fallback;
}
function stayWrite(key,value){
 stayMemory[key]=value;
 try{const storage=nativeStayApp()?localStorage:sessionStorage;if(value===null){storage.removeItem('aq-stay-'+key);if(nativeStayApp())sessionStorage.removeItem('aq-stay-'+key);}else storage.setItem('aq-stay-'+key,JSON.stringify(value));return true;}catch{return false;}
}
function paymentLink(value){if(typeof value!=='string')return '';try{const url=new URL(value,location.origin);return url.origin===location.origin&&url.pathname==='/hotel-payment.html'&&/^#AQH-[A-Z0-9]+:[a-f0-9]{64}$/.test(url.hash)?url.pathname+url.hash:'';}catch{return '';}}
function rememberBooking(b,url){const list=stayRead('receipts',[]).filter(x=>x.booking_code!==b.booking_code);list.unshift({...b,payment_url:paymentLink(url)});stayWrite('receipts',list.slice(0,50));}
function timeLabel(value){const d=new Date(value);if(!value||!Number.isFinite(d.getTime()))return 'راجع شروط المنشأة';return new Intl.DateTimeFormat('ar-SY',{timeZone:'Asia/Damascus',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d)+' بتوقيت دمشق';}
function cancellationNote(q){return q.cancellation_deadline&&Date.now()<=new Date(q.cancellation_deadline).getTime()?`إلغاء مجاني حتى ${timeLabel(q.cancellation_deadline)}.`:'هذه الإقامة داخل مهلة الإلغاء؛ لا يتاح إلغاؤها مجانًا عبر الموقع. راجع شروط المنشأة قبل التأكيد.';}
function checkoutSteps(step){return `<ol class="booking-steps" aria-label="مراحل الحجز">${['بيانات الضيف','المراجعة والتأكيد','تفاصيل الحجز'].map((label,i)=>`<li ${step===i+1?'aria-current="step"':''}><b>${i+1}</b>${label}</li>`).join('')}</ol>`;}
function bookingSummary(q,hotel){const photo=hotel?hotelPhotos(hotel)[0]:null;return `<aside class="booking-summary">${photo?`<img src="${esc(photo)}" alt="${esc(q.hotel_name)}">`:''}<span class="eyebrow">ملخص إقامتك</span><h3>${esc(q.hotel_name)}</h3><p class="meta">${esc(q.room_name)}</p><div class="booking-dates"><div>الوصول<strong>${dateLabel(q.check_in)}</strong></div><div>المغادرة<strong>${dateLabel(q.check_out)}</strong></div></div><div class="meta">${unitCount(q.rooms_count)} · ${guestCount(Number(q.adults)+(Number(q.children)||0))} لكل وحدة</div>${unitPriceLines(q)}</aside>`;}
async function bookingForm(hotelId,roomId,previousDraft){
 const pending=stayRead('pending',null);if(pending){showPendingBooking(pending);return;}
 const request=beginStayDialog('إتمام الحجز'),fields={hotel_id:hotelId,room_id:roomId,check_in:selectedSearch.checkIn,check_out:selectedSearch.checkOut,adults:selectedSearch.adults,children:selectedSearch.children||0,rooms_count:selectedSearch.rooms};
 try{
  const j=await stayApi('/api/mobile/hotels/quote?'+new URLSearchParams(fields));if(request!==hotelRequest)return;
  if(!j.data?.nightly)throw Error('تعذر التحقق من عرض السعر. أعد المحاولة.');
  const draft={fields,quote:j.data,hotel:selectedHotel?.id==hotelId?selectedHotel:null,guest:previousDraft?.guest||{guest_name:'',guest_phone:'',guest_email:'',special_requests:'',payment_method:'pay_at_hotel'},request};checkoutDraft=draft;drawGuestStep(draft);
 }catch(e){if(request!==hotelRequest)return;$('modalBody').innerHTML=`<div class="stay-empty"><h2>نحتاج مراجعة التوفر</h2><p role="alert">${esc(e.message)}</p><button class="primary" type="button" onclick="openHotel(${Number(hotelId)})">العودة إلى الوحدات</button></div>`;}
}
function drawGuestStep(draft){
 const {quote:q,guest:g}=draft,manual=q.payment_methods?.find(m=>m.id==='shamcash_manual');
 if(g.payment_method==='shamcash_manual'&&!manual?.available)g.payment_method='pay_at_hotel';
 $('dialogLabel').textContent='إتمام الحجز · بيانات الضيف';
 $('modalBody').innerHTML=`<button type="button" class="text-button booking-back" id="backToUnits">→ العودة إلى الوحدات</button>${checkoutSteps(1)}<div class="booking-layout"><section class="booking-panel"><span class="eyebrow">الخطوة الأولى</span><h2>من سيقيم معنا؟</h2><p class="muted">أدخل بيانات الضيف الرئيسي. ستراجع الحجز كاملًا قبل إرساله.</p><form id="bookingForm" class="booking"><label>الاسم الكامل<input name="guest_name" required minlength="2" maxlength="180" autocomplete="name" value="${esc(g.guest_name)}"></label><div class="two-fields"><label>رقم الهاتف<input name="guest_phone" type="tel" required minlength="7" maxlength="80" autocomplete="tel" dir="ltr" value="${esc(g.guest_phone)}"></label><label>البريد الإلكتروني <small>اختياري</small><input name="guest_email" type="email" maxlength="220" autocomplete="email" dir="ltr" value="${esc(g.guest_email)}"></label></div><label>طريقة الدفع<select id="paymentMethod" name="payment_method"><option value="pay_at_hotel">الدفع عند الوصول</option>${manual?`<option value="shamcash_manual" ${manual.available?'':'disabled'} ${g.payment_method==='shamcash_manual'?'selected':''}>تحويل عبر شام كاش${manual.available?' — مراجعة يدوية':' — غير متاح حاليًا'}</option>`:''}</select></label><div id="paymentNote" class="payment-note" role="status"></div><label>طلبات خاصة <small>اختيارية، وتخضع لتأكيد المنشأة</small><textarea name="special_requests" maxlength="2000" placeholder="موعد وصول متوقع، أو أي تفاصيل تهمّك…">${esc(g.special_requests)}</textarea></label><p class="muted">الحجز أثناء تسجيل الدخول يظهر في حسابك ويتيح تقييم الإقامة. <a href="/host-portal.html?return_to=${encodeURIComponent('/hotels.html?hotel='+q.hotel_id)}">الدخول أو إنشاء حساب</a>. يمكنك أيضًا المتابعة كضيف وحفظ رقم الحجز.</p><button type="submit" class="primary" id="reviewBooking">مراجعة الحجز ←</button><p id="bookingError" class="booking-error" role="alert"></p></form></section>${bookingSummary(q,draft.hotel)}</div>`;
 const form=$('bookingForm');const capture=()=>draft.guest=Object.fromEntries(new FormData(form));
 $('paymentMethod').onchange=()=>{
  const sham=$('paymentMethod').value==='shamcash_manual';$('paymentNote').textContent=sham?`المبلغ المطلوب تحويله: ${money(manual.amount,manual.currency)}${manual.exchange_rate?' · بسعر صرف '+Number(manual.exchange_rate).toLocaleString('en-US'):''}. يبقى الحجز بانتظار مراجعة الإدارة حتى تأكيد وصول التحويل.`:'تدفع قيمة الإقامة للمنشأة عند الوصول. لن تُسجّل هذه العملية كدفعة إلكترونية.';
 };$('paymentMethod').onchange();
 $('backToUnits').onclick=()=>{capture();openHotel(draft.fields.hotel_id);};
 form.onsubmit=e=>{e.preventDefault();if(!form.reportValidity())return;capture();if(!/^[+\d\s()\-٠-٩]{7,80}$/.test(draft.guest.guest_phone.trim())){$('bookingError').textContent='راجع رقم الهاتف؛ أدخل أرقامًا صالحة مع رمز البلد إن أمكن.';return;}drawReviewStep(draft);};
 document.querySelector('.modalbox').scrollTop=0;const heading=$('modalBody').querySelector('.booking-panel h2,.receipt-header h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
}
function drawReviewStep(draft,message=''){
 const {quote:q,guest:g}=draft,sham=g.payment_method==='shamcash_manual',manual=q.payment_methods?.find(m=>m.id==='shamcash_manual');
 $('dialogLabel').textContent='إتمام الحجز · المراجعة والتأكيد';
 $('modalBody').innerHTML=`${checkoutSteps(2)}<div class="booking-layout"><section class="booking-panel"><span class="eyebrow">الخطوة الثانية</span><h2>كل التفاصيل، قبل إرسال الطلب.</h2>${isDemoHotel(draft.hotel)?'<p class="notice warning">منشأة تجريبية: هذا اختبار ولا يؤكد إقامة حقيقية.</p>':''}<dl class="review-details"><div><dt>اسم الضيف</dt><dd>${esc(g.guest_name)}</dd></div><div><dt>رقم الهاتف</dt><dd dir="ltr">${esc(g.guest_phone)}</dd></div><div><dt>البريد الإلكتروني</dt><dd>${esc(g.guest_email||'لم يُضف')}</dd></div><div><dt>طريقة الدفع</dt><dd>${sham?'شام كاش — مراجعة يدوية':'الدفع عند الوصول'}</dd></div></dl>${g.special_requests?`<p class="notice">طلبك الخاص: ${esc(g.special_requests)}</p>`:''}<div class="notice ${q.cancellation_deadline&&new Date(q.cancellation_deadline)>new Date()?'':'warning'}">${esc(cancellationNote(q))}</div><details class="nightly" open><summary>شروط الإقامة والإلغاء</summary><div class="payment-note">${stayPolicies(q.stay_terms||{})}</div></details>${sham?`<p class="notice warning">التحويل المطلوب: <strong>${money(manual.amount,manual.currency)}</strong>. بعد إنشاء الحجز ستظهر بيانات الاستلام. يتطلب الحجز موافقة الفندق ومراجعة التحويل المالي.</p>`:'<p class="muted">بعد إرسال الطلب سنعرض رقمه هنا. لن يتأكد الحجز حتى يوافق الفندق. احتفظ به للوصول إلى الحجز لاحقًا.</p>'}<form id="confirmBookingForm" class="booking"><label class="check"><input name="accept_stay_terms" type="checkbox" required>راجعت التواريخ والسعر النهائي وشروط الإقامة والإلغاء وأوافق عليها.</label><div class="checkout-actions"><button type="button" class="outline" id="editGuest">تعديل البيانات</button><button type="submit" class="primary" id="confirmBooking">${sham?'إنشاء الحجز ومتابعة التحويل':'إرسال طلب الحجز'} ←</button></div><p id="bookingError" class="booking-error" role="alert">${esc(message)}</p></form></section>${bookingSummary(q,draft.hotel)}</div>`;
 $('editGuest').onclick=()=>drawGuestStep(draft);
 $('confirmBookingForm').onsubmit=e=>{
  e.preventDefault();if(bookingFlight||!e.currentTarget.reportValidity())return;
  if(stayRead('pending',null)){showPendingBooking(stayRead('pending',null));return;}
  const body={...draft.fields,...g,expected_total:q.total,expected_currency:q.currency,expected_terms_version:q.terms_version,booking_flow:2,accept_stay_terms:true,idempotency_key:crypto.randomUUID()};
  if(sham){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);Object.assign(body,{payment_access_token:Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join(''),payment_settings_version:manual.settings_version,expected_transfer_amount:manual.amount,expected_transfer_currency:manual.currency});}
  const pending={body,quote:q,created_at:new Date().toISOString()};const persisted=stayWrite('pending',pending);if(!persisted){stayWrite('pending',null);$('bookingError').textContent='تعذر حفظ طلب الحجز على الجهاز؛ لم يُرسل الطلب. تحقق من المساحة المتاحة ثم أعد المحاولة.';return;}
  submitStayBooking(pending,draft);
 };
 document.querySelector('.modalbox').scrollTop=0;const heading=$('modalBody').querySelector('.booking-panel h2,.receipt-header h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
}
function showPendingBooking(pending){
 beginStayDialog('متابعة طلب الحجز');
 $('modalBody').innerHTML=`<div class="booking-panel"><span class="eyebrow">نتحقق من نتيجة الطلب</span><h2>لديك طلب حجز لم يصل تأكيده بعد.</h2><p class="notice warning">قد يكون الحجز سُجّل قبل انقطاع الاتصال. أعد المحاولة لاسترجاع نتيجة الطلب نفسه؛ لن ننشئ حجزًا ثانيًا.</p><p>${esc(pending.quote.hotel_name)} · ${dateLabel(pending.body.check_in)} — ${dateLabel(pending.body.check_out)}</p><p><strong>${money(pending.body.expected_total,pending.body.expected_currency)}</strong></p><button type="button" class="primary" id="retryBooking" ${bookingFlight?'disabled':''}>${bookingFlight?'جارٍ التحقق…':'متابعة الطلب نفسه'}</button><p id="bookingError" role="alert"></p></div>`;
 $('retryBooking').onclick=()=>submitStayBooking(pending,checkoutDraft);
}
async function submitStayBooking(pending,draft){
 if(bookingFlight)return;bookingFlight=true;const request=hotelRequest;
 const button=$('confirmBooking')||$('retryBooking');if(button){button.disabled=true;button.textContent='جارٍ تأكيد الطلب…';}if($('editGuest'))$('editGuest').disabled=true;
 try{
  const j=await stayApi('/api/mobile/hotels/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.body)});
  if(!j.data?.booking_code)throw Error('لم يصل رقم الحجز. أعد التحقق من الطلب نفسه.');
  stayWrite('pending',null);rememberBooking(j.data,j.manual_payment?.checkout_url);
  if(request===hotelRequest)drawBookingReceipt(j.data,j.manual_payment?.checkout_url,true);else toastStay('وصلت نتيجة الحجز. يمكنك فتحها من «حجوزاتي».');
  search();
 }catch(e){
  const rejected=e.status>=400&&e.status<500;if(rejected)stayWrite('pending',null);
  if(request!==hotelRequest){toastStay(rejected?e.message:'افتح «حجوزاتي» للتحقق من طلب الحجز السابق.');return;}
  if(rejected){
   $('modalBody').innerHTML=`<div class="stay-empty"><h2>لم يكتمل الحجز</h2><p role="alert">${esc(e.message)}</p><p>راجع التوفر والسعر والشروط المحدّثة قبل إعادة التأكيد.</p><button type="button" class="primary" id="refreshQuote">مراجعة عرض السعر</button><button type="button" class="text-button" onclick="openHotel(${Number(pending.body.hotel_id)})">اختيار وحدة أخرى</button></div>`;
   $('refreshQuote').onclick=()=>{selectedSearch={checkIn:pending.body.check_in,checkOut:pending.body.check_out,adults:pending.body.adults,children:pending.body.children,rooms:pending.body.rooms_count};bookingForm(pending.body.hotel_id,pending.body.room_id,draft||{guest:pending.body});};
  }else{showPendingBooking(pending);$('bookingError').textContent=e.message;}
 }finally{bookingFlight=false;const retry=$('retryBooking');if(retry){retry.disabled=false;retry.textContent='متابعة الطلب نفسه';}}
}
const statusNames={confirmed:'حجز مؤكد',pending:'بانتظار تأكيد الفندق',cancelled:'ملغى',completed:'إقامة مكتملة',checked_in:'تم تسجيل الوصول',checked_out:'تمت المغادرة',no_show:'عدم حضور'};
function drawBookingReceipt(b,url,newBooking=false){
 const stored=stayRead('receipts',[]).find(x=>x.booking_code===b.booking_code),paymentUrl=paymentLink(url||stored?.payment_url);
 rememberBooking(b,paymentUrl);$('dialogLabel').textContent='تفاصيل الحجز';
 const canCancel=typeof b.can_cancel==='boolean'?b.can_cancel:['pending','confirmed'].includes(b.status)&&new Date(b.cancellation_deadline)>new Date();
 const headline=b.status==='confirmed'?'حجزك مؤكد. رحلة طيبة!':b.status==='pending'?(b.approval_status==='approved'?'وافق الفندق — بانتظار الدفع':'طلبك بانتظار تأكيد الفندق'):b.status==='cancelled'?(b.approval_status==='rejected'?'رفض الفندق طلب الحجز':'تم إلغاء الحجز'):statusNames[b.status]||'تفاصيل الحجز';
 const q={...b,subtotal:b.subtotal??b.total,discount_amount:Math.max(0,Number(b.subtotal??b.total)-Number(b.total)),nightly:b.price_breakdown};
 $('modalBody').innerHTML=`${newBooking?checkoutSteps(3):''}<div class="receipt-header"><div class="receipt-icon" aria-hidden="true">${b.status==='confirmed'?'✓':b.status==='cancelled'?'×':'⌁'}</div><h2>${headline}</h2><p class="muted">احتفظ برقم الحجز؛ يتيح عرضه وإدارته، ولا تشاركه علنًا.</p><strong class="receipt-code">${esc(b.booking_code)}</strong><span class="receipt-status">${esc(statusNames[b.status]||b.status)}</span></div><div class="booking-layout"><section class="booking-panel"><h3>تفاصيل إقامتك</h3><dl class="review-details"><div><dt>المنشأة</dt><dd>${esc(b.hotel_name)}</dd></div><div><dt>الوحدة</dt><dd>${esc(b.room_name)}</dd></div><div><dt>حالة الدفع</dt><dd>${b.payment_status==='paid'?'تم الدفع':b.payment_status==='refunded'?'تم رد المبلغ':'لم يُسجّل دفع مؤكد'}</dd></div><div><dt>طريقة الدفع</dt><dd>${b.payment_method==='shamcash_manual'?'شام كاش — مراجعة يدوية':'عند الوصول'}</dd></div></dl>${b.status==='pending'?'<p class="notice warning">الحجز غير مؤكد بعد. يحتاج موافقة الفندق؛ وفي حال اختيار شام كاش يحتاج أيضًا مراجعة التحويل. لا تتوجه إلى المنشأة قبل ظهور حالة «مؤكد».</p>':''}${paymentUrl&&b.status!=='cancelled'?`<a class="primary" href="${esc(paymentUrl)}">متابعة الدفع عبر شام كاش ←</a>`:''}${b.approval_note?`<p class="notice">رد الفندق: ${esc(b.approval_note)}</p>`:''}<h3>الإقامة والإلغاء</h3>${stayPolicies(b.stay_terms_snapshot||{})}<p class="notice">${b.status==='cancelled'?'أُلغي الحجز. إذا سددت مبلغًا، راجع المنشأة أو الإدارة لمتابعة الاسترداد؛ الإلغاء لا يحوّل المال تلقائيًا.':esc(cancellationNote(b))}</p><div class="receipt-actions"><button type="button" class="outline" id="copyBookingCode">نسخ رقم الحجز</button><button type="button" class="outline" id="printBooking">طباعة تفاصيل الطلب</button><button type="button" class="outline" id="refreshBooking">تحديث الحالة</button>${canCancel?'<button type="button" class="text-button" id="cancelBooking">إلغاء الحجز</button>':''}</div><p id="receiptMessage" role="status" class="muted"></p><div id="cancelArea"></div><button type="button" class="text-button no-print" id="backToBookings">→ جميع حجوزاتي</button></section>${bookingSummary(q,null)}</div>`;
 $('copyBookingCode').onclick=async()=>{try{await navigator.clipboard.writeText(b.booking_code);$('receiptMessage').textContent='تم نسخ رقم الحجز.';}catch{$('receiptMessage').textContent='يمكنك تحديد رقم الحجز أعلاه ونسخه يدويًا.';}};
 $('printBooking').onclick=()=>{document.querySelectorAll('.nightly').forEach(el=>el.open=true);if(nativeStayApp())location.href='aqartkom-app://print';else window.print();};
 $('refreshBooking').onclick=()=>loadBookingReceipt(b.booking_code);$('backToBookings').onclick=showMyBookings;
 if(canCancel)$('cancelBooking').onclick=()=>{
  $('cancelArea').innerHTML=`<form id="cancelForm" class="cancel-form"><h3>هل تريد إلغاء هذه الإقامة؟</h3><p class="muted">سيُحرّر الحجز والوحدات. إذا دفعت مسبقًا، تابع استرداد المبلغ مع الإدارة.</p><label>سبب الإلغاء <small>اختياري</small><textarea name="reason" maxlength="500"></textarea></label><div class="checkout-actions"><button type="button" class="outline" id="keepBooking">الاحتفاظ بالحجز</button><button type="submit" class="primary">نعم، إلغاء الحجز</button></div><p role="alert" id="cancelError"></p></form>`;$('keepBooking').onclick=()=>{$('cancelArea').replaceChildren();};
  $('cancelForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;try{const j=await stayApi('/api/stays/booking/'+encodeURIComponent(b.booking_code)+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:new FormData(form).get('reason')})});if(!j.data)throw Error('تعذر قراءة حالة الحجز. حدّث الحالة.');if(form.isConnected)drawBookingReceipt(j.data,paymentUrl);search();}catch(err){if(form.isConnected){$('cancelError').textContent=err.message;button.disabled=false;}}};
 };
 document.querySelector('.modalbox').scrollTop=0;const heading=$('modalBody').querySelector('.booking-panel h2,.receipt-header h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
}
async function loadBookingReceipt(code){
 const request=beginStayDialog('تفاصيل الحجز');try{const j=await stayApi('/api/stays/booking/'+encodeURIComponent(String(code).trim().toUpperCase()));if(request!==hotelRequest)return;if(!j.data)throw Error('تعذر عرض الحجز');drawBookingReceipt(j.data);}catch(e){if(request!==hotelRequest)return;$('modalBody').innerHTML=`<div class="stay-empty"><h2>تعذر عرض الحجز</h2><p role="alert">${esc(e.message)}</p><button type="button" class="outline" id="backToLookup">العودة إلى حجوزاتي</button></div>`;$('backToLookup').onclick=showMyBookings;}
}
async function showMyBookings(){
 const request=beginStayDialog('حجوزاتي');
 $('modalBody').innerHTML=`<span class="eyebrow">رحلاتك، في مكان واحد</span><h2>حجوزاتي</h2><p class="muted">اعرض حجوزات حسابك، أو أدخل رقم الحجز الذي احتفظت به.</p><div id="pendingStay"></div><form id="lookupBooking" class="lookup-form"><label>رقم الحجز<input name="code" dir="ltr" placeholder="AQH-…" pattern="[Aa][Qq][Hh]-[A-Za-z0-9]{6,36}" required autocomplete="off"></label><button type="submit" class="primary">عرض الحجز ←</button></form><p id="bookingsNote" class="muted" role="status">جارٍ تحميل الحجوزات…</p><div id="bookingList" class="booking-list"></div>`;
 const pending=stayRead('pending',null);if(pending){$('pendingStay').innerHTML='<div class="notice warning">يوجد طلب سابق لم تصل نتيجته بعد. <button type="button" class="text-button" id="resumeStay">التحقق من نتيجة الطلب</button></div>';$('resumeStay').onclick=()=>showPendingBooking(pending);}
 $('lookupBooking').onsubmit=e=>{e.preventDefault();loadBookingReceipt(new FormData(e.currentTarget).get('code'));};
 const local=stayRead('receipts',[]);let rows=[...local];
 try{const j=await stayApi('/api/stays/bookings');if(request!==hotelRequest)return;rows=[...(j.data||[]),...local.filter(b=>!j.data?.some(x=>x.booking_code===b.booking_code))];$('bookingsNote').textContent=j.signed_in?(nativeStayApp()?'حجوزات حسابك، والسجل المحفوظ على هذا الجهاز.':'حجوزات حسابك، وما حفظته في هذه الجلسة.'):(nativeStayApp()?'كضيف، تظهر هنا الحجوزات المحفوظة على هذا الجهاز. احتفظ برقم الحجز للوصول إليه من جهاز آخر.':'كضيف، تظهر هنا الحجوزات المحفوظة في جلسة التصفح الحالية فقط. احتفظ برقم حجزك للوصول إليه لاحقًا.');}
 catch(e){if(request!==hotelRequest)return;$('bookingsNote').textContent=e.message+(nativeStayApp()?' تظهر أدناه الحجوزات المحفوظة على الجهاز.':' تظهر أدناه الحجوزات المحفوظة في هذه الجلسة.');}
 if(request!==hotelRequest)return;
 $('bookingList').innerHTML=rows.map((b,i)=>`<button type="button" data-booking-index="${i}"><span><strong>${esc(b.hotel_name)}</strong><small>${dateLabel(b.check_in)} — ${dateLabel(b.check_out)} · ${esc(b.room_name)}</small><small dir="ltr">${esc(b.booking_code)}</small></span><span><strong>${money(b.total,b.currency)}</strong><small>${esc(statusNames[b.status]||b.status)} · عرض التفاصيل ←</small></span></button>`).join('')||'<div class="stay-empty"><h3>لا توجد حجوزات لعرضها هنا</h3><p>يمكنك إدخال رقم حجز سابق أعلاه أو العودة لاختيار إقامتك.</p></div>';
 document.querySelectorAll('[data-booking-index]').forEach(el=>el.onclick=()=>loadBookingReceipt(rows[Number(el.dataset.bookingIndex)].booking_code));
}

// Android back returns through checkout before leaving the service.
window.aqartkomNativeBack=function(){
 if(document.querySelector('.media-image-viewer,.property-video-viewer,.listing-dialog[open]'))return false;
 if($('modal').classList.contains('hidden'))return false;
 if($('keepBooking')){$('keepBooking').click();return true;}
 if($('confirmBookingForm')&&checkoutDraft&&!bookingFlight){drawGuestStep(checkoutDraft);return true;}
 if($('bookingForm')&&checkoutDraft){openHotel(checkoutDraft.fields.hotel_id);return true;}
 closeHotelDetails();return true;
};
