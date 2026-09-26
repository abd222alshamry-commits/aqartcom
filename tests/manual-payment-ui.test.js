'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto');
function dom(){const elements=new Map();return {elements,getElementById(id){if(!elements.has(id))elements.set(id,{value:id==='paymentMethod'?'pay_at_hotel':'',textContent:'',innerHTML:'',disabled:false,hidden:false,addEventListener(){},insertAdjacentHTML(_where,text){this.innerHTML+=text;}});return elements.get(id);}};}
test('checkout disables unavailable Sham Cash, reviews the transfer and never treats a pending payment as confirmed',async t=>{
 const {JSDOM}=require('jsdom');const root=path.join(__dirname,'..');
 const browser=new JSDOM(fs.readFileSync(path.join(root,'hotels.html'),'utf8'),{url:'https://example.test/hotels.html',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>browser.window.close());
 const w=browser.window,requests=[];let available=false;
 w.HTMLElement.prototype.scrollIntoView=function(){};
 const base={hotel_id:1,room_id:2,hotel_name:'Test hotel',room_name:'Room',total:80,subtotal:80,currency:'USD',check_in:'2099-06-01',check_out:'2099-06-03',nights:2,rooms_count:1,adults:2,terms_version:1,stay_terms:{},cancellation_deadline:'2099-05-31T11:00:00Z',nightly:[{date:'2099-06-01',rooms_count:1,total:40},{date:'2099-06-02',rooms_count:1,total:40}]};
 w.fetch=async(url,options)=>{
  if(url.startsWith('/api/stays/search'))return {ok:true,json:async()=>({data:[]})};
  if(url.startsWith('/api/mobile/hotels/quote'))return {ok:true,json:async()=>({data:{...base,payment_methods:[{id:'shamcash_manual',available,reason:'بانتظار إعداد حساب الاستلام',amount:960000,currency:'SYP',exchange_rate:12000,settings_version:2}]}})};
  assert.equal(url,'/api/mobile/hotels/book');const sent=JSON.parse(options.body);requests.push(sent);
  return {ok:true,json:async()=>({data:{...base,booking_code:'AQH-123456789012345678',status:'pending',payment_method:'shamcash_manual',payment_status:'pending'},manual_payment:{checkout_url:'/hotel-payment.html#AQH-123456789012345678:'+sent.payment_access_token}})};
 };
 for(const file of ['listing-cover.js','media-gallery.js','hotel-details.js','stay-checkout.js','hotels.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),browser.getInternalVMContext());
 vm.runInContext("selectedSearch={checkIn:'2099-06-01',checkOut:'2099-06-03',adults:2,children:0,rooms:1};selectedHotel={id:1,name:'Test hotel',slug:'test'};",browser.getInternalVMContext());
 await w.bookingForm(1,2);assert.equal(w.document.querySelector('option[value=shamcash_manual]').disabled,true);
 available=true;await w.bookingForm(1,2);
 const form=w.document.getElementById('bookingForm');form.elements.guest_name.value='Test guest';form.elements.guest_phone.value='00000000';form.elements.payment_method.value='shamcash_manual';form.elements.payment_method.onchange();
 assert.match(w.document.getElementById('paymentNote').textContent,/SYP/);form.querySelector('[type=submit]').click();
 assert.match(w.document.getElementById('modalBody').textContent,/960,000 SYP/);w.document.querySelector('[name=accept_stay_terms]').checked=true;w.document.getElementById('confirmBooking').click();
 for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));
 assert.equal(requests.length,1);assert.equal(requests[0].expected_transfer_amount,960000);assert.match(requests[0].payment_access_token,/^[a-f0-9]{64}$/);assert.equal(requests[0].accept_stay_terms,true);
 assert.match(w.document.querySelector('.receipt-header').textContent,/بانتظار التأكيد/);assert.doesNotMatch(w.document.querySelector('.receipt-header').textContent,/حجزك مؤكد/);assert.ok(w.document.querySelector('a[href^="/hotel-payment.html#"]'));
});
test('private receipt renders pending review without another transfer form and escapes review text',async()=>{
  const document=dom(),token='a'.repeat(64),receipt={hotel_name:'Test hotel',room_name:'Room',booking_code:'AQH-123456789012345678',booking_total:80,booking_currency:'USD',amount:960000,currency:'SYP',booking_status:'pending',payment_status:'pending',status:'pending_review',review_note:'<img src=x onerror=alert(1)>',transaction_reference:'123456'};
  const context=vm.createContext({document,location:{hash:'#'+receipt.booking_code+':'+token},navigator:{},fetch:async(_url,options)=>{assert.equal(options.headers.Authorization,'Bearer '+token);return {ok:true,json:async()=>({data:receipt})};}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../hotel-payment.js'),'utf8'),context);
  await new Promise(r=>setImmediate(r));
  assert.match(document.getElementById('message').textContent,/بانتظار مراجعة/);
  const html=document.getElementById('payment').innerHTML;
  assert.match(html,/لا تُكرر التحويل/);assert.doesNotMatch(html,/<form|<img src=x/);assert.match(html,/&lt;img/);
});
