'use strict';
const crypto=require('node:crypto');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value||'').slice(0,10);
const stamp=value=>{const date=new Date(value);return Number.isNaN(+date)?'—':date.toLocaleString('ar-SY',{timeZone:'Asia/Damascus'});};
const validCode=code=>/^AQH-[A-Z0-9]{6,36}$/.test(String(code));
const documentPath=code=>'/api/stays/booking/'+encodeURIComponent(code)+'/document';
function snapshot(b,h={},r={}){
 const keys=['booking_code','guest_name','check_in','check_out','nights','rooms_count','adults','children','subtotal','total','currency','status','approval_status','approval_note','payment_method','payment_status','cancellation_deadline','cancellation_reason','special_requests','stay_terms_snapshot','updated_at','created_at'];
 return {...Object.fromEntries(keys.map(k=>[k,b[k]??null])),hotel_name:h.name||b.hotel_name||'',hotel_city:h.city||b.hotel_city||'',hotel_district:h.district||b.hotel_district||'',room_name:r.name||b.room_name||''};
}
function state(b){
 if(b.approval_status==='rejected')return {title:'رفض الفندق طلب الحجز',tone:'cancelled',note:'هذا الطلب مرفوض ولا يتيح الإقامة. إذا سبق الدفع، تابع الاسترداد مع الإدارة.'};
 if(b.status==='cancelled')return {title:'الحجز ملغى',tone:'cancelled',note:'الإلغاء لا ينفّذ استردادًا ماليًا تلقائيًا. راجع الإدارة بشأن أي مبلغ سبق دفعه.'};
 if(b.status==='confirmed')return {title:'الحجز مؤكد',tone:'confirmed',note:'وافق الفندق على الحجز. راجع مواعيد الوصول وشروط الإقامة أدناه.'};
 if(b.status==='pending')return b.approval_status==='approved'
  ?{title:'وافق الفندق - بانتظار الدفع',tone:'pending',note:'وافق الفندق، لكن الحجز لا يزال غير مؤكد حتى اعتماد الدفعة المطلوبة.'}
  :{title:'بانتظار تأكيد الفندق',tone:'pending',note:'تم استلام طلبك. هذه النسخة لا تؤكد الإقامة؛ انتظر موافقة الفندق، واعتماد الدفعة إذا اخترت شام كاش.'};
 return {title:({completed:'إقامة مكتملة',checked_in:'تم تسجيل الوصول',checked_out:'تمت المغادرة',no_show:'عدم حضور'})[b.status]||'تفاصيل الحجز',tone:'neutral',note:'توضح هذه النسخة حالة الحجز عند آخر تحديث مسجّل.'};
}
const money=(value,currency)=>`${Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency||''}`;
function renderHtml(b,{interactive=false,pdfHref=documentPath(b.booking_code)+'.pdf'}={}){
 const status=state(b),terms=b.stay_terms_snapshot||{};
 const row=(label,value,ltr=false)=>`<tr><th>${esc(label)}</th><td${ltr?' dir="ltr"':''}>${esc(value||'—')}</td></tr>`;
 const payment=({paid:'تم تسجيل الدفع',refunded:'تم تسجيل استرداد المبلغ',failed:'تعذر الدفع'})[b.payment_status]||'لم يُسجّل دفع مؤكد';
 const notes=[['رد الفندق',b.approval_note],['سبب الإلغاء',b.status==='cancelled'?b.cancellation_reason:null],['طلبات الضيف',b.special_requests],['سياسة الإلغاء',terms.cancellation_policy],['شروط الإقامة',terms.rental_terms]].filter(([,value])=>value);
 return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>عقارتكم - ${esc(b.booking_code)}</title><style>
 @page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;background:#eef2f6;color:#18283d;font:14px/1.8 'DejaVu Sans',Arial,sans-serif}.document{max-width:790px;margin:28px auto;padding:38px;background:white;border:1px solid #dce4ed;border-radius:18px}.brand{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #16736b;padding-bottom:18px;margin-bottom:24px}.brand strong{font-size:29px;color:#126b64}.brand span{font-size:12px;color:#63758c}.eyebrow{margin:0;color:#63758c;font-size:12px}h1{font-size:23px;margin:6px 0 12px}h2{font-size:16px;margin:25px 0 9px}.notice{padding:14px 18px;border-radius:10px;background:#fff4db;border:1px solid #efd297;break-inside:avoid}.notice.confirmed{background:#e9f6ef;border-color:#aed7bd}.notice.cancelled{background:#fbecef;border-color:#eabac2}.notice.neutral{background:#edf2f7;border-color:#c9d5e2}.code{font-size:17px;font-weight:bold;letter-spacing:1px;overflow-wrap:anywhere}.reference{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;margin:20px 0}.reference small{display:block;color:#63758c}table{width:100%;border-collapse:collapse;margin:12px 0}tr{break-inside:avoid}th,td{padding:9px 12px;border-bottom:1px solid #e3e9f0;text-align:right;vertical-align:top;overflow-wrap:anywhere}th{width:34%;font-weight:normal;color:#63758c;background:#f6f8fb}td{font-weight:600}td[dir=ltr]{text-align:right}.total{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;margin:18px 0;background:#14384d;color:white;border-radius:10px;break-inside:avoid}.total strong{font-size:22px}.detail-note{margin:12px 0;white-space:pre-wrap;overflow-wrap:anywhere}.note{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.footer{border-top:1px solid #dce4ed;padding-top:15px;margin-top:28px;font-size:11px;color:#63758c}.actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:20px auto}.actions a{background:#146f67;color:white;padding:11px 20px;text-decoration:none;border-radius:9px;font-weight:bold}.actions a.secondary{background:#e1e9ef;color:#18283d}.actions-note{text-align:center;font-size:13px;color:#52657d}a{color:#146f67}bdi{unicode-bidi:isolate}@media(max-width:600px){.document{margin:12px;padding:22px;border-radius:12px}.brand strong{font-size:24px}h1{font-size:20px}th,td{padding:8px}.total strong{font-size:18px}}@media print{body{background:white;font-size:12px}.document{margin:0;padding:0;border:0;border-radius:0;max-width:none}.actions,.actions-note{display:none!important}.brand{margin-bottom:18px}.total,.notice,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}h2{break-after:avoid}.footer{break-inside:avoid}}
 @media print{body{line-height:1.55}.brand{padding-bottom:10px;margin-bottom:12px}.brand strong{font-size:24px}h1{font-size:20px;margin:4px 0 8px}h2{margin:14px 0 6px;font-size:14px}.reference{margin:12px 0}.notice{padding:10px 14px}table{margin:7px 0}th,td{padding:4px 8px}.total{padding:10px 14px;margin:12px 0}.total strong{font-size:20px}.footer{margin-top:18px;padding-top:10px;font-size:10px}}
 </style></head><body>${interactive?`<nav class="actions"><a id="downloadBookingDocument" href="${esc(pdfHref)}" download>تنزيل ملف PDF</a><a class="secondary" href="/hotels.html#booking=${esc(b.booking_code)}">عرض حالة الحجز الحالية</a></nav><p class="actions-note" id="documentHint">يمكنك تنزيل الملف والاحتفاظ به أو إرساله للفندق.</p>`:''}<main class="document"><header class="brand"><strong>عقارتكم</strong><span dir="ltr">AQARTKOM · STAYS</span></header><p class="eyebrow">نسخة تفاصيل الحجز</p><h1>${esc(status.title)}</h1><div class="notice ${status.tone}">${esc(status.note)}</div><div class="reference"><div><small>رقم الحجز</small><bdi class="code">${esc(b.booking_code)}</bdi></div><div><small>آخر تحديث بتوقيت دمشق</small><span>${esc(stamp(b.updated_at||b.created_at))}</span></div></div><h2>الضيف والإقامة</h2><table>${row('الضيف الرئيسي',b.guest_name)}${row('المنشأة',b.hotel_name)}${row('الموقع',[b.hotel_city,b.hotel_district].filter(Boolean).join(' / '))}${row('الغرفة أو الوحدة',b.room_name)}${row('الوصول',day(b.check_in)+' · '+(terms.check_in_time||'14:00'),true)}${row('المغادرة',day(b.check_out)+' · '+(terms.check_out_time||'12:00'),true)}${row('تفاصيل الإقامة',`${b.nights||1} ليلة / ${b.rooms_count||1} وحدة / ${b.adults||1} بالغ / ${b.children||0} طفل`)}</table><h2>السعر والدفع</h2><table>${row('طريقة الدفع',b.payment_method==='shamcash_manual'?'شام كاش - مراجعة يدوية':'الدفع عند الوصول')}${row('حالة الدفع',payment)}${Number(b.subtotal)>Number(b.total)?row('الإجمالي قبل الخصم',money(b.subtotal,b.currency),true)+row('الخصم',money(Number(b.subtotal)-Number(b.total),b.currency),true):''}</table><div class="total"><span>الإجمالي النهائي</span><strong dir="ltr">${esc(money(b.total,b.currency))}</strong></div><h2>الإقامة والإلغاء</h2><p>${esc(b.cancellation_deadline?'موعد انتهاء الإلغاء المجاني: '+stamp(b.cancellation_deadline)+' بتوقيت دمشق.':'راجع شروط الإلغاء مع المنشأة.')}</p>${b.approval_status==='pending'&&b.status==='pending'?'<p>يمكن سحب الطلب قبل موافقة الفندق من صفحة الحجز.</p>':''}${notes.map(([label,value])=>`<p class="detail-note"><strong>${esc(label)}: </strong>${esc(value)}</p>`).join('')}<footer class="footer">هذه وثيقة تفاصيل حجز وليست فاتورة ضريبية أو إثبات سداد. حالة الحجز قابلة للتحديث؛ راجع أحدث حالة قبل الوصول. احتفظ برقم الحجز بشكل خاص.</footer></main>${interactive?'<script src="/booking-document.js?v=1"></script>':''}</body></html>`;
}
function createPdfRenderer({binary=process.env.CHROMIUM_PATH||'/usr/bin/chromium',launch}={}){
 let active=0,tail=Promise.resolve();const cache=new Map();
 return async function renderPdf(data){
  const html=renderHtml(data),key=crypto.createHash('sha256').update(html).digest('hex');
  const found=cache.get(key);if(found&&Date.now()-found.at<300000)return found.buffer;
  if(active>=3)throw Object.assign(Error('PDF_BUSY'),{status:503,code:'PDF_BUSY'});
  active++;const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});
  await previous;let browser,timer,stage='load';
  try{
   const cached=cache.get(key);if(cached&&Date.now()-cached.at<300000)return cached.buffer;
   const start=launch||(await import(require.resolve('puppeteer-core'))).launch;
   stage='launch';
   browser=await start({executablePath:binary,headless:true,pipe:true,timeout:15000,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-extensions','--disable-background-networking','--disable-sync','--no-first-run','--renderer-process-limit=1']});
   timer=setTimeout(()=>browser.process()?.kill('SIGKILL'),30000);timer.unref();
   stage='page';const page=await browser.newPage();page.setDefaultTimeout(15000);
   await page.setJavaScriptEnabled(false);await page.setOfflineMode(true);
   stage='content';await page.setContent(html,{waitUntil:'load',timeout:15000});
   stage='pdf';const buffer=Buffer.from(await page.pdf({format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false,timeout:15000}));
   if(!buffer.subarray(0,5).equals(Buffer.from('%PDF-'))||buffer.length>5*1024*1024)throw Object.assign(Error('PDF_INVALID'),{code:'PDF_INVALID'});
   cache.set(key,{at:Date.now(),buffer});while(cache.size>16)cache.delete(cache.keys().next().value);
   return buffer;
  }catch(error){
   const reason=/cannot find (?:package|module)/i.test(error.message)?'DEPENDENCY_MISSING':/ENOENT|not found at the configured executablePath/i.test(error.message)?'EXECUTABLE_MISSING':/target closed|connection closed/i.test(error.message)?'BROWSER_CLOSED':/timed? ?out|timeout/i.test(error.message)?'TIMEOUT':/EACCES|permission denied/i.test(error.message)?'PERMISSION_DENIED':/out of memory|ENOMEM/i.test(error.message)?'MEMORY_LIMIT':'RENDER_ERROR';
   throw Object.assign(Error('PDF_RENDER_FAILED'),{code:'PDF_RENDER_FAILED',stage,reason});
  }
  finally{if(timer)clearTimeout(timer);if(browser){const kill=setTimeout(()=>browser.process()?.kill('SIGKILL'),3000);kill.unref();await browser.close().catch(()=>{});clearTimeout(kill);}active--;release();}
 };
}
function emailMessage(job,{baseUrl,snapshot:data}){
 const base=new URL(baseUrl);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('INVALID_APP_URL');
 if(!/^\/(?:hotels|hotel-partner)\.html(?:[?#][^\r\n]*)?$/.test(job.action_url))throw Error('INVALID_BOOKING_LINK');
 const action=base.origin+job.action_url,pdf=base.origin+documentPath(data.booking_code)+'.pdf',status=state(data);
 return {subject:job.title,text:job.body+'\n\nعرض الحجز: '+action+'\nتحميل PDF: '+pdf+'\nنسخة تفاصيل الحجز مرفقة بصيغة PDF.',html:`<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#eff3f7;font-family:Arial,sans-serif;color:#18283d"><div style="max-width:620px;margin:24px auto;padding:28px;background:white;border-radius:14px"><h2 style="color:#146f67">عقارتكم</h2><h1 style="font-size:23px">${esc(job.title)}</h1><p style="line-height:1.9;white-space:pre-line">${esc(job.body)}</p><p style="padding:14px;background:#f3f6fa;line-height:1.8">${esc(status.note)}</p><p><a style="display:inline-block;background:#146f67;color:white;padding:12px 20px;text-decoration:none;border-radius:8px" href="${esc(action)}">${job.action_url.startsWith('/hotel-partner')?'فتح طلب الحجز وإدارته':'عرض حالة الحجز'}</a></p><p><a href="${esc(pdf)}">تحميل نسخة PDF الحالية</a></p><p style="color:#61748b;font-size:13px">أرفقنا نسخة PDF توضح حالة الحجز وقت هذا الإشعار. احتفظ برقم الحجز بشكل خاص.</p></div></body></html>`};
}
async function sendBookingEmail(job,{pool,renderPdf,createTransport,env=process.env}){
 let data=job.document_snapshot;
 if(!data){const b=(await pool.query('SELECT b.*,h.name hotel_name,h.city hotel_city,h.district hotel_district,r.name room_name FROM hotel_bookings b JOIN hotels h ON h.id=b.hotel_id JOIN hotel_rooms r ON r.id=b.room_id WHERE b.id=$1',[job.booking_id])).rows[0];if(!b)throw Error('BOOKING_MISSING');data=snapshot(b);}
 const message=emailMessage(job,{baseUrl:env.APP_URL||env.RENDER_EXTERNAL_URL||'http://localhost:'+(env.PORT||3000),snapshot:data});
 const content=await renderPdf(data),transport=createTransport(require('./smtp-diagnostics').smtpOptions(env));
 try{
  const info=await transport.sendMail({...message,from:env.SMTP_FROM||env.SMTP_USER,to:job.recipient,messageId:'<hotel-notification-'+job.id+'@aqartkom.app>',disableFileAccess:true,disableUrlAccess:true,attachments:[{filename:'Aqartkom-'+String(data.booking_code).replace(/[^A-Z0-9-]/g,'')+'.pdf',content,contentType:'application/pdf'}]});
  if(!Array.isArray(info.accepted)||!info.accepted.some(address=>String(address).toLowerCase()===job.recipient.toLowerCase()))throw Object.assign(Error('RECIPIENT_NOT_ACCEPTED'),{code:'RECIPIENT_NOT_ACCEPTED'});
 }finally{try{transport.close?.();}catch(_error){}}
}
async function verifyRenderer(renderPdf){
 try{
  const data=snapshot({booking_code:'AQH-PDFCHECK2026',guest_name:'اختبار جاهزية الملف',hotel_name:'عقارتكم',room_name:'نسخة اختبار',check_in:'2099-01-01',check_out:'2099-01-02',nights:1,rooms_count:1,adults:1,total:0,currency:'USD',status:'pending',approval_status:'pending',updated_at:'2026-10-02T00:00:00Z'});
  const buffer=await renderPdf(data);return {ready:buffer.subarray(0,5).equals(Buffer.from('%PDF-'))};
 }catch(error){return {ready:false,code:'PDF_RENDER_FAILED',stage:error.stage||'unknown',reason:error.reason||'RENDER_ERROR'};}
}
function register(app,{pool,requireOfficeMember,ownedHotel,renderPdf}){
 const select='SELECT b.*,h.name hotel_name,h.city hotel_city,h.district hotel_district,r.name room_name FROM hotel_bookings b JOIN hotels h ON h.id=b.hotel_id JOIN hotel_rooms r ON r.id=b.room_id';
 const handle=manager=>async(req,res)=>{
  res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'});
  try{
   if(manager&&!await ownedHotel(req.params.hotelId,req.office))return res.status(404).json({error:'الحجز غير موجود'});
   if(!manager&&!validCode(req.params.code))return res.status(404).json({error:'الحجز غير موجود'});
   const b=(await pool.query(select+(manager?' WHERE b.id=$1 AND b.hotel_id=$2':' WHERE b.booking_code=$1'),manager?[req.params.id,req.params.hotelId]:[req.params.code])).rows[0];
   if(!b)return res.status(404).json({error:'الحجز غير موجود'});
   const data=snapshot(b);
   if(req.path.endsWith('.pdf')){const buffer=await renderPdf(data);res.type('pdf').set('Content-Disposition',`attachment; filename="Aqartkom-${String(b.booking_code).replace(/[^A-Z0-9-]/g,'')}.pdf"`).send(buffer);}
   else{res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");res.type('html').send(renderHtml(data,{interactive:true,pdfHref:req.path+'.pdf'}));}
  }catch(e){res.status(e.status===503?503:500).set('Retry-After','15').json({error:'تعذر تجهيز ملف PDF الآن. أعد المحاولة بعد قليل.'});}
 };
 app.get(['/api/stays/booking/:code/document','/api/stays/booking/:code/document.pdf'],handle(false));
 app.get(['/api/office/hotels/:hotelId/bookings/:id/document','/api/office/hotels/:hotelId/bookings/:id/document.pdf'],requireOfficeMember,handle(true));
}
module.exports={snapshot,state,renderHtml,createPdfRenderer,emailMessage,sendBookingEmail,verifyRenderer,register,documentPath};
