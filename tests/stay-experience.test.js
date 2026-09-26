'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const express=require('express'),{PGlite}=require('@electric-sql/pglite'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),source=file=>fs.readFileSync(path.join(root,file),'utf8');
async function fixture(t){
 const db=new PGlite();await db.waitReady;await db.exec(source('server/db/schema.sql'));t.after(()=>db.close());
 const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 const h=(await db.query("INSERT INTO hotels(name,slug,city,district,lodging_type,status,images,rental_terms) VALUES('شاليه الاختبار المعزول','isolated-chalet','طرطوس','مشتى الحلو','chalet','active','[\"/assets/property-villa.webp\"]','يمنع التدخين') RETURNING *")).rows[0];
 const room=(await db.query("INSERT INTO hotel_rooms(hotel_id,name,room_type,max_guests,quantity,price,currency) VALUES($1,'الشاليه كاملًا','entire_unit',3,2,100,'USD') RETURNING *",[h.id])).rows[0];
 const app=express();app.use(express.json());require('../server/mobile-hotels').register(app,{pool,getCurrentUser:async()=>null,syncHotel:async()=>{}});
 app.get('/api/hotels/:id/reviews',(_q,r)=>r.json({data:[]}));app.get('/api/hotels/:id/review-bookings',(_q,r)=>r.status(401).json({error:'تسجيل الدخول مطلوب'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const origin='http://127.0.0.1:'+server.address().port;
 const call=async(url,body)=>{const r=await fetch(origin+url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {status:r.status,json:await r.json()};};
 const fields={hotel_id:h.id,room_id:room.id,check_in:'2099-06-01',check_out:'2099-06-04',adults:2,children:1,rooms_count:1};
 const search=new URLSearchParams({checkIn:fields.check_in,checkOut:fields.check_out,adults:2,children:1,rooms:1,region:'mashta',lodging_type:'chalet'});
 return {db,pool,h,room,origin,call,fields,search};
}
test('search, availability and confirmation agree on nightly prices, discounts and occupancy; receipts are immutable and cancellation is idempotent',async t=>{
 const {db,h,room,call,fields,search}=await fixture(t);
 await db.query("INSERT INTO hotel_room_rates(room_id,start_date,end_date,price,currency) VALUES($1,'2099-06-02','2099-06-04',150,'USD')",[room.id]);
 await db.query("INSERT INTO hotel_promotions(hotel_id,name,start_date,end_date,discount_percent) VALUES($1,'عرض الليلة الأخيرة','2099-06-03','2099-06-04',20)",[h.id]);
 for(const [i,ci,co] of [[1,'2099-06-01','2099-06-02'],[2,'2099-06-02','2099-06-04']])await db.query("INSERT INTO hotel_bookings(booking_code,hotel_id,room_id,guest_name,guest_phone,check_in,check_out,nights,unit_price,subtotal,total) VALUES($1,$2,$3,'Seed','123456789',$4,$5,1,100,100,100)",['SEED-'+i,h.id,room.id,ci,co]);
 const listing=await call('/api/stays/search?'+search);assert.equal(listing.status,200);assert.equal(listing.json.data[0].from_total,370);
 assert.equal((await call('/api/stays/search?'+search+'&currency=SYP')).json.data.length,0);assert.equal((await call('/api/stays/search?'+search+'&currency=USD&maxTotal=369')).json.data.length,0);
 assert.equal((await call('/api/stays/search?'+search+'&sort=price')).status,400);
 const availability=await call('/api/stays/'+h.id+'/availability?'+search);assert.equal(availability.json.data[0].quote.total,370);assert.equal(availability.json.data[0].quote.available,1);
 const quote=await call('/api/mobile/hotels/quote?'+new URLSearchParams(fields));assert.equal(quote.json.data.total,370);assert.deepEqual(quote.json.data.nightly.map(n=>n.total),[100,150,120]);
 assert.equal((await call('/api/mobile/hotels/quote?'+new URLSearchParams({...fields,children:2}))).status,409);
 const b={...fields,guest_name:'Test Guest',guest_phone:'+963900000000',payment_method:'pay_at_hotel',expected_total:370,expected_currency:'USD',expected_terms_version:1,booking_flow:2,accept_stay_terms:true,idempotency_key:crypto.randomUUID()};
 assert.equal((await call('/api/mobile/hotels/book',{...b,accept_stay_terms:'yes'})).status,400);
 const booked=await call('/api/mobile/hotels/book',b);assert.equal(booked.status,201,JSON.stringify(booked));assert.equal(booked.json.data.children,1);assert.equal(booked.json.data.status,'confirmed');assert.equal(booked.json.data.payment_status,'pending');
 assert.deepEqual(booked.json.data.price_breakdown.map(n=>n.total),[100,150,120]);
 const repeated=await call('/api/mobile/hotels/book',b);assert.equal(repeated.json.data.booking_code,booked.json.data.booking_code);assert.equal(repeated.json.repeated,true);
 assert.equal((await call('/api/mobile/hotels/book',{...b,idempotency_key:crypto.randomUUID()})).status,409);assert.equal((await call('/api/stays/search?'+search)).json.data.length,0);
 await db.query('UPDATE hotel_room_rates SET price=900 WHERE room_id=$1',[room.id]);
 const receipt=(await call('/api/stays/booking/'+booked.json.data.booking_code)).json.data;assert.equal(receipt.total,'370.00');assert.deepEqual(receipt.price_breakdown.map(n=>n.total),[100,150,120]);assert.equal(receipt.can_cancel,true);
 for(const privateKey of ['guest_name','guest_phone','guest_email','idempotency_key','request_hash','user_id','commission_amount'])assert.equal(Object.hasOwn(receipt,privateKey),false);
 assert.equal((await call('/api/stays/bookings')).json.signed_in,false);
 const cancel=await call('/api/stays/booking/'+receipt.booking_code+'/cancel',{reason:'تغيير خطط الرحلة'});assert.equal(cancel.json.data.status,'cancelled');assert.equal(cancel.json.data.can_cancel,false);
 assert.equal((await call('/api/stays/booking/'+receipt.booking_code+'/cancel',{reason:'إعادة المحاولة'})).json.repeated,true);
 assert.equal((await db.query("SELECT COUNT(*)::int n FROM hotel_booking_events WHERE booking_id=(SELECT id FROM hotel_bookings WHERE booking_code=$1) AND event_type='cancelled'",[receipt.booking_code])).rows[0].n,1);
 assert.equal((await call('/api/stays/search?'+search)).json.data.length,1);
 await db.query("INSERT INTO hotel_availability_blocks(room_id,start_date,end_date,quantity,reason) VALUES($1,'2099-06-03','2099-06-04',1,'صيانة')",[room.id]);
 assert.equal((await call('/api/stays/search?'+search)).json.data.length,0);
});
test('mixed seasonal currencies and minimum stays are explained without misleading prices',async t=>{
 const {db,h,room,call,fields,search}=await fixture(t);
 await db.query("INSERT INTO hotel_room_rates(room_id,start_date,end_date,price,currency,min_nights) VALUES($1,'2099-06-02','2099-06-04',150,'SYP',1)",[room.id]);
 let a=await call('/api/stays/'+h.id+'/availability?'+search);assert.equal(a.json.data[0].available,false);assert.match(a.json.data[0].unavailable_reason,/عملة/);
 assert.equal((await call('/api/stays/search?'+search)).json.data.length,0);
 await db.query("UPDATE hotel_room_rates SET currency='USD',min_nights=4 WHERE room_id=$1",[room.id]);
 a=await call('/api/mobile/hotels/quote?'+new URLSearchParams(fields));assert.equal(a.status,409);assert.match(a.json.error,/الحد الأدنى/);
 await db.query('UPDATE hotel_room_rates SET min_nights=1 WHERE room_id=$1',[room.id]);
 const q=(await call('/api/mobile/hotels/quote?'+new URLSearchParams(fields))).json.data;
 const b={...fields,guest_name:'Test Guest',guest_phone:'123456789',payment_method:'pay_at_hotel',expected_total:q.total,expected_currency:q.currency,expected_terms_version:q.terms_version,idempotency_key:crypto.randomUUID()};
 await db.query('UPDATE hotels SET terms_version=terms_version+1 WHERE id=$1',[h.id]);assert.equal((await call('/api/mobile/hotels/book',b)).status,409);
 assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotel_bookings')).rows[0].n,0);
});
test('real website journey selects a chalet, reviews, recovers a lost confirmation without a duplicate, reloads and cancels',async t=>{
 const {db,origin,h,room}=await fixture(t),errors=[],calls=[];let loseResponse=true;
 function browser(){
  const dom=new JSDOM(source('hotels.html'),{url:origin+'/hotels.html?region=mashta&lodging_type=chalet&checkIn=2099-06-01&checkOut=2099-06-04&children=1',runScripts:'dangerously',pretendToBeVisual:true});t.after(()=>dom.window.close());
  const w=dom.window;w.matchMedia=()=>({matches:true});w.HTMLElement.prototype.scrollIntoView=function(){};w.addEventListener('error',e=>errors.push(e.message));
  w.fetch=async(url,options={})=>{calls.push({url:String(url),body:options.body});const response=await fetch(new URL(url,origin),{...options,signal:undefined});if(String(url)==='/api/mobile/hotels/book'&&loseResponse){loseResponse=false;throw new w.TypeError('Connection lost after commit');}return response;};
  for(const file of ['listing-cover.js','media-gallery.js','hotel-details.js','stay-checkout.js','hotels.js'])vm.runInContext(source(file),dom.getInternalVMContext(),{filename:file});return {dom,w};
 }
 const pause=()=>new Promise(r=>setTimeout(r,10));async function until(fn){for(let i=0;i<200;i++){if(fn())return;await pause();}throw Error('Timed out waiting for UI');}
 let {w}=browser();await until(()=>w.document.querySelector('.hotel-name'));
 assert.equal(w.document.querySelector('.price').textContent,'300 USD');w.document.querySelector('.hotel-name').click();await until(()=>w.document.querySelector('.room-book'));
 assert.equal(w.document.querySelectorAll('#hotelMedia .media-gallery-item').length,1);w.document.querySelector('.room-book').click();await until(()=>w.document.getElementById('bookingForm'));
 const form=w.document.getElementById('bookingForm');form.elements.guest_name.value='ضيف اختبار';form.elements.guest_phone.value='+963900000000';form.elements.special_requests.value='وصول مساءً';form.querySelector('[type=submit]').click();
 assert.ok(w.document.querySelector('#confirmBookingForm [name=accept_stay_terms]').required);assert.match(w.document.querySelector('.review-details').textContent,/ضيف اختبار/);
 w.document.getElementById('editGuest').click();assert.equal(w.document.getElementById('bookingForm').elements.special_requests.value,'وصول مساءً');w.document.getElementById('reviewBooking').click();
 w.document.querySelector('[name=accept_stay_terms]').checked=true;w.document.getElementById('confirmBooking').click();await until(()=>w.document.getElementById('retryBooking')&&!w.document.getElementById('retryBooking').disabled);
 assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotel_bookings')).rows[0].n,1);
 const persisted=w.sessionStorage.getItem('aq-stay-pending');assert.ok(persisted);
 const old=w;({w}=browser());w.sessionStorage.setItem('aq-stay-pending',persisted);old.close();await w.showMyBookings();w.document.getElementById('resumeStay').click();w.document.getElementById('retryBooking').click();await until(()=>w.document.querySelector('.receipt-code'));
 assert.equal(w.sessionStorage.getItem('aq-stay-pending'),null);assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotel_bookings')).rows[0].n,1);
 const posts=calls.filter(c=>c.url==='/api/mobile/hotels/book');assert.equal(posts.length,2);assert.equal(posts[0].body,posts[1].body);assert.match(w.document.querySelector('.receipt-header').textContent,/حجزك مؤكد/);
 const code=w.document.querySelector('.receipt-code').textContent;await w.showMyBookings();assert.match(w.document.getElementById('bookingList').textContent,new RegExp(code));w.document.querySelector('[data-booking-index]').click();await until(()=>w.document.getElementById('cancelBooking'));
 w.document.getElementById('cancelBooking').click();w.document.querySelector('#cancelForm [type=submit]').click();await until(()=>w.document.querySelector('.receipt-header')?.textContent.includes('تم إلغاء الحجز'));
 assert.equal((await db.query('SELECT status FROM hotel_bookings WHERE room_id=$1',[room.id])).rows[0].status,'cancelled');assert.equal(w.document.getElementById('cancelBooking'),null);assert.deepEqual(errors,[]);
 await until(()=>w.document.getElementById('hotels').getAttribute('aria-busy')==='false');w.closeHotelDetails();assert.equal(w.document.querySelector('main').inert,false);
});
