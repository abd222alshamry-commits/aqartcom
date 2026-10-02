'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {JSDOM}=require('jsdom');
async function waitFor(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI did not reach expected state');}
test('manager opens booking from notification, retains failed decision, submits once and saves email',async t=>{
 const html=fs.readFileSync(__dirname+'/../hotel-partner.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'https://example.test/hotel-partner.html?hotel=5&tab=bookings',runScripts:'outside-only'});const w=dom.window;t.after(()=>w.close());
 w.HTMLElement.prototype.scrollIntoView=function(){};w.confirm=()=>true;
 let decisionCalls=0,status='pending',decision='pending',email='',emailReady=false,connection={verified:null},deliveryStatus='queued',attempts=0;
 w.fetch=async(url,options={})=>{let body={},code=200;
 if(url==='/api/auth/me')body={user:{id:1,role:'user',is_host:true,name:'Manager',email:'manager@example.test'}};
 else if(url==='/api/office/hotels')body={data:[{id:5,name:'فندق الاختبار',city:'دمشق',status:'active'}]};
 else if(url.endsWith('/rooms'))body={data:[]};
 else if(url.endsWith('/bookings'))body={data:[{id:7,booking_code:'AQH-TEST',guest_name:'ضيف',guest_phone:'123456789',room_name:'غرفة',check_in:'2099-10-01',check_out:'2099-10-03',total:100,currency:'USD',status,approval_status:decision}]};
 else if(url.endsWith('/booking-notifications')){if(options.method==='PUT')email=JSON.parse(options.body).email;body={email:'manager@example.test',custom_email:email,email_ready:emailReady,email_connection:connection,deliveries:[{booking_id:7,status:deliveryStatus,recipient:'manager@example.test',attempts}],pending:status==='pending'?1:0};}
 else if(url==='/api/office/hotel-bookings/7'){decisionCalls++;assert.equal(options.method,'PATCH');const b=JSON.parse(options.body);assert.equal(b.status,'cancelled');assert.equal(b.note,'غير متاح');if(decisionCalls===1){code=503;body={error:'تعذر الاتصال مؤقتًا'};}else{status='cancelled';decision='rejected';body={data:{status,approval_status:decision}};}}
 else throw Error('Unexpected request '+url);
 return {ok:code<400,status:code,json:async()=>body};};
 w.eval(fs.readFileSync(__dirname+'/../hotel-partner.js','utf8'));
 await waitFor(()=>w.document.querySelector('#booking-7'));assert.match(w.document.getElementById('panel').textContent,/بانتظار موافقتك/);assert.match(w.document.getElementById('panel').textContent,/خدمة البريد غير مهيأة/);
 assert.match(w.document.querySelector('#booking-7 .booking-delivery').textContent,/بانتظار الإرسال/);assert.equal(w.document.querySelector('#booking-7 .booking-pdf').getAttribute('href'),'/api/office/hotels/5/bookings/7/document.pdf');assert.ok(w.document.querySelector('#booking-7 .guest-booking-delivery'));
 emailReady=true;connection={verified:false};deliveryStatus='failed';attempts=8;await w.renderBookings();
 assert.match(w.document.getElementById('panel').textContent,/تعذر الاتصال بخدمة البريد/);
 assert.match(w.document.querySelector('#booking-7 .booking-delivery').textContent,/تعذر إرسال البريد/);
 assert.match(w.document.querySelector('#booking-7 .booking-delivery').textContent,/manager@example.test/);
 assert.ok(w.document.querySelector('#booking-7 button'),'mail failure must not block the hotel decision');
 connection={verified:true};deliveryStatus='sent';await w.renderBookings();
 assert.match(w.document.getElementById('panel').textContent,/نجح آخر فحص/);
 assert.match(w.document.querySelector('#booking-7 .booking-delivery').textContent,/تم إرسال البريد/);
 assert.match(w.document.getElementById('panel').textContent,/خدمة البريد قبلت الرسالة/);
 w.reviewBooking(7,'cancelled');const form=w.document.getElementById('bookingDecisionForm');form.elements.note.value='غير متاح';await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(form.elements.note.value,'غير متاح');assert.equal(form.querySelector('button').disabled,false);assert.match(w.document.getElementById('decisionError').textContent,/تعذر الاتصال/);
 await form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(decisionCalls,2);assert.match(w.document.getElementById('panel').textContent,/رفض الفندق الطلب/);assert.equal(w.document.querySelector('#booking-7 button'),null);
 const settings=w.document.getElementById('bookingEmailForm');settings.elements.email.value='new@example.test';await settings.onsubmit({preventDefault(){},currentTarget:settings});assert.equal(email,'new@example.test');assert.match(w.document.getElementById('bookingEmailMessage').textContent,/تم حفظ/);
});
