'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const docs=require('../server/hotel-booking-document');
const booking={booking_code:'AQH-123456789ABCDEF123',guest_name:'ضيف <script>bad()</script>',guest_phone:'PRIVATE PHONE',guest_email:'private@example.test',payment_access_token:'PRIVATE TOKEN',hotel_name:'فندق مشتى الحلو',room_name:'غرفة 204',check_in:'2099-10-01',check_out:'2099-10-03',nights:2,rooms_count:1,adults:2,children:0,total:150,currency:'USD',status:'pending',approval_status:'pending',payment_status:'pending',payment_method:'pay_at_hotel',updated_at:'2026-10-02T11:00:00Z'};
test('Arabic booking documents escape customer text, preserve pending/payment states and exclude private fields',()=>{
 const snapshot=docs.snapshot(booking),html=docs.renderHtml(snapshot,{interactive:true});
 assert.equal(snapshot.guest_email,undefined);assert.equal(snapshot.guest_phone,undefined);assert.equal(snapshot.payment_access_token,undefined);
 assert.match(html,/lang="ar" dir="rtl"/);assert.match(html,/بانتظار تأكيد الفندق/);assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/PRIVATE|<script>bad/);assert.match(html,/document\.pdf/);
 assert.equal(docs.state({...snapshot,status:'pending',approval_status:'approved'}).title,'وافق الفندق - بانتظار الدفع');
 assert.equal(docs.state({...snapshot,status:'confirmed',approval_status:'approved'}).title,'الحجز مؤكد');
 assert.equal(docs.state({...snapshot,status:'cancelled',approval_status:'rejected'}).title,'رفض الفندق طلب الحجز');
});
test('mail contains the recorded PDF snapshot, real recipient and escaped links, and rejected SMTP acceptance fails',async()=>{
 const job={id:5,booking_id:9,recipient:'guest@example.test',title:'تم استلام الطلب',body:'ضيف <img src=x onerror=bad()>',action_url:'/hotels.html#booking='+booking.booking_code,document_snapshot:docs.snapshot(booking)};
 let sent,closed=0;
 const dependencies={pool:{query:()=>assert.fail('must use immutable event snapshot')},env:{SMTP_HOST:'smtp.gmail.com',SMTP_USER:'sender@example.test',SMTP_PASS:'secret',APP_URL:'https://example.test'},renderPdf:async data=>{assert.equal(data.status,'pending');return Buffer.from('%PDF-fixture');},createTransport:config=>{assert.equal(config.requireTLS,true);return {sendMail:async message=>{sent=message;return {accepted:[job.recipient]};},close(){closed++;}};}};
 await docs.sendBookingEmail(job,dependencies);
 assert.equal(sent.to,job.recipient);assert.match(sent.text,/https:\/\/example.test\/api\/stays\/booking\/AQH-123456789ABCDEF123\/document.pdf/);assert.doesNotMatch(sent.html,/<img/);
 assert.equal(sent.attachments.length,1);assert.equal(sent.attachments[0].contentType,'application/pdf');assert.equal(sent.attachments[0].content.toString(),'%PDF-fixture');assert.equal(sent.disableFileAccess,true);assert.equal(sent.disableUrlAccess,true);assert.equal(closed,1);
 dependencies.createTransport=()=>({sendMail:async()=>({accepted:[]}),close(){closed++;}});
 await assert.rejects(docs.sendBookingEmail(job,dependencies),error=>error.code==='RECIPIENT_NOT_ACCEPTED');assert.equal(closed,2);
 assert.throws(()=>docs.emailMessage({...job,action_url:'//foreign.example'}, {baseUrl:'https://example.test',snapshot:job.document_snapshot}),/INVALID_BOOKING_LINK/);
});
test('PDF generation caps concurrent work and caches identical documents, with scripting and network disabled',async()=>{
 let starts=0,closes=0,finish;const gate=new Promise(r=>{finish=r;});
 const render=docs.createPdfRenderer({launch:async()=>{starts++;return {process:()=>null,close:async()=>{closes++;},newPage:async()=>({setDefaultTimeout(){},setJavaScriptEnabled:async enabled=>assert.equal(enabled,false),setOfflineMode:async offline=>assert.equal(offline,true),setContent:async html=>{assert.doesNotMatch(html,/<script/);await gate;},pdf:async options=>{assert.equal(options.preferCSSPageSize,true);return Buffer.from('%PDF-fixture');}})};}});
 const a=render(booking),b=render(booking),c=render({...booking,status:'confirmed'});
 await assert.rejects(render({...booking,booking_code:'AQH-DIFFERENT'}),error=>error.status===503);
 finish();await Promise.all([a,b,c]);assert.equal(starts,2);assert.equal(closes,2);
 await render(booking);assert.equal(starts,2);
});
test('Android document action opens the existing native PDF save dialog while browsers retain download',()=>{
 const {hostPath}=require('../server/host-portal');assert.equal(hostPath({path:'/api/office/hotels/1/bookings/2/document.pdf',method:'GET'}),true);
 assert.equal(hostPath({path:'/api/office/hotels/1/bookings/2/unknown',method:'GET'}),false);
 const {JSDOM}=require('jsdom'),source=fs.readFileSync(__dirname+'/../booking-document.js','utf8');
 for(const [agent,native] of [['AqartkomNative/190',true],['Mozilla/5.0',false]]){
  const dom=new JSDOM(docs.renderHtml(docs.snapshot(booking),{interactive:true}),{url:'https://example.test/api/stays/booking/'+booking.booking_code+'/document',runScripts:'outside-only'});
  Object.defineProperty(dom.window.navigator,'userAgent',{value:agent});dom.window.eval(source);
  const link=dom.window.document.getElementById('downloadBookingDocument');
  assert.equal(link.getAttribute('href'),native?'aqartkom-app://print':docs.documentPath(booking.booking_code)+'.pdf');assert.equal(link.hasAttribute('download'),!native);dom.window.close();
 }
});
