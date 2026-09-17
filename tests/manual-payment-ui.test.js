'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto');
function dom(){const elements=new Map();return {elements,getElementById(id){if(!elements.has(id))elements.set(id,{value:id==='paymentMethod'?'pay_at_hotel':'',textContent:'',innerHTML:'',disabled:false,hidden:false,addEventListener(){},insertAdjacentHTML(_where,text){this.innerHTML+=text;}});return elements.get(id);}};}
test('hotel checkout shows Sham Cash when unavailable and never presents a pending transfer as paid',async()=>{
  const document=dom(),requests=[];
  let available=false;
  const base={total:80,currency:'USD',check_in:'2099-06-01',check_out:'2099-06-03',nights:2,rooms_count:1};
  const context=vm.createContext({document,crypto:webcrypto,Uint8Array,URL,URLSearchParams,Date,location:{origin:'https://example.test'},FormData:class {constructor(target){this.values=target;}get(k){return this.values[k]||'';}},fetch:async(url,options)=>{
    if(url.startsWith('/api/hotels?'))return {ok:true,json:async()=>({data:[]})};
    if(url.startsWith('/api/mobile/hotels/quote'))return {ok:true,json:async()=>({data:{...base,payment_methods:[{id:'shamcash_manual',available,reason:'بانتظار إعداد حساب الاستلام',amount:960000,currency:'SYP',exchange_rate:12000,settings_version:2}]}})};
    assert.equal(url,'/api/mobile/hotels/book');const sent=JSON.parse(options.body);requests.push(sent);
    return {ok:true,json:async()=>({data:{booking_code:'AQH-123456789012345678',status:'pending',payment_status:'pending'},manual_payment:{checkout_url:'/hotel-payment.html#AQH-123456789012345678:'+sent.payment_access_token}})};
  }});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../hotels.js'),'utf8'),context);
  await new Promise(r=>setImmediate(r));
  vm.runInContext("selectedSearch={checkIn:'2099-06-01',checkOut:'2099-06-03',adults:2,rooms:1};selectedHotel={name:'Test hotel',slug:'test'};",context);
  await context.bookingForm(1,2);
  assert.match(document.getElementById('modalBody').innerHTML,/تحويل عبر شام كاش/);
  document.getElementById('paymentMethod').value='shamcash_manual';document.getElementById('paymentMethod').onchange();
  assert.equal(document.getElementById('confirmBooking').disabled,true);assert.match(document.getElementById('paymentNote').textContent,/إعداد حساب/);
  available=true;await context.bookingForm(1,2);
  assert.equal(document.getElementById('confirmBooking').disabled,false);assert.match(document.getElementById('paymentNote').textContent,/SYP/);
  await document.getElementById('bookingForm').onsubmit({preventDefault(){},target:{guest_name:'Test guest',guest_phone:'00000000',payment_method:'shamcash_manual'}});
  assert.equal(requests.length,1);assert.equal(requests[0].expected_transfer_amount,960000);assert.match(requests[0].payment_access_token,/^[a-f0-9]{64}$/);
  assert.match(document.getElementById('modalBody').innerHTML,/بانتظار التحويل/);assert.doesNotMatch(document.getElementById('modalBody').innerHTML,/تم الدفع بنجاح|تم تأكيد الحجز/);
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
