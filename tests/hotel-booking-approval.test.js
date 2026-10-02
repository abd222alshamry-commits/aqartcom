'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),express=require('express');
const {createService}=require('../server/hotel-booking-approval'),mobile=require('../server/mobile-hotels');
test('hotel approval, scoped decisions and durable notifications stay consistent with real SQL',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());const schema=fs.readFileSync(__dirname+'/../server/db/schema.sql','utf8');await db.exec(schema);await db.exec(schema);
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 const user=async(name,role='user')=>(await db.query('INSERT INTO users(name,email,password_hash,role,is_host) VALUES($1,$2,\'test\',$3,TRUE) RETURNING *',[name,name+'@example.test',role])).rows[0];
 const owner=await user('manager'),guest=await user('guest'),other=await user('other');
 const h=(await db.query("INSERT INTO hotels(owner_id,name,slug,city,status) VALUES($1,'Local Hotel','approval-test','دمشق','active') RETURNING *",[owner.id])).rows[0];
 const room=(await db.query("INSERT INTO hotel_rooms(hotel_id,name,room_type,price,quantity,max_guests) VALUES($1,'Local room','double',50,10,2) RETURNING *",[h.id])).rows[0];
 let ready=false,failEmail=false;const sent=[];
 const service=createService({pool,emailReady:()=>ready,sendEmail:async job=>{if(failEmail)throw Object.assign(Error('test failure'),{code:'ETIMEDOUT'});sent.push(job);}});
 const app=express();app.use(express.json());mobile.register(app,{pool,getCurrentUser:async()=>guest,syncHotel:async()=>{},bookingApproval:service});
 const auth=(req,res,next)=>{const id=Number(req.get('x-user'));if(!id)return res.status(401).json({error:'auth'});req.user={id,role:'user'};req.office={id:null,owner_id:id};next();};
 const ownedHotel=async(id,office)=>(await db.query('SELECT * FROM hotels WHERE id=$1 AND owner_id=$2',[id,office.owner_id])).rows[0];service.register(app,{requireOfficeMember:auth,ownedHotel});
 const rendered=[];require('../server/hotel-booking-document').register(app,{pool,requireOfficeMember:auth,ownedHotel,renderPdf:async data=>{rendered.push(data);return Buffer.from('%PDF-booking-test');}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 async function req(path,body,who,method='POST',origin){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{'x-user':who}:{}),...(origin?{Origin:origin}:{})},...(method!=='GET'?{body:JSON.stringify(body)}:{})});return {status:r.status,cacheControl:r.headers.get('cache-control'),...await r.json()};}
 const make=()=>({hotel_id:h.id,room_id:room.id,check_in:'2099-10-01',check_out:'2099-10-03',adults:2,rooms_count:1,guest_name:'Guest',guest_phone:'12345678',guest_email:guest.email,expected_total:100,expected_currency:'USD',payment_method:'pay_at_hotel',idempotency_key:crypto.randomUUID()});
 const body=make(),first=await req('/api/mobile/hotels/book',body);assert.equal(first.status,201,JSON.stringify(first));assert.equal(first.data.status,'pending');assert.equal(first.data.approval_status,'pending');
 const booking=(await db.query('SELECT * FROM hotel_bookings WHERE booking_code=$1',[first.data.booking_code])).rows[0];
 let notices=(await db.query('SELECT * FROM user_notifications')).rows;assert.equal(notices.length,2);assert.equal(notices.find(n=>n.user_id===owner.id).action_url,`/hotel-partner.html?hotel=${h.id}&tab=bookings`);assert.match(notices.find(n=>n.user_id===guest.id).title,/تم استلام طلبك/);
 assert.equal((await req('/api/mobile/hotels/book',body)).repeated,true);assert.equal((await db.query('SELECT * FROM user_notifications')).rows.length,2);assert.equal((await db.query("SELECT * FROM hotel_notification_outbox WHERE channel='email'")).rows.length,2);
 const pdfPath=`/api/office/hotels/${h.id}/bookings/${booking.id}/document.pdf`;
 assert.equal((await fetch(base+pdfPath)).status,401);
 assert.equal((await fetch(base+pdfPath,{headers:{'x-user':String(other.id)}})).status,404);
 const pdf=await fetch(base+pdfPath,{headers:{'x-user':String(owner.id)}});assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/application\/pdf/);assert.match(pdf.headers.get('content-disposition'),/attachment/);assert.match(pdf.headers.get('cache-control'),/no-store/);assert.equal(await pdf.text(),'%PDF-booking-test');assert.equal(rendered[0].status,'pending');assert.equal(rendered[0].guest_email,undefined);
 const guestPdf=await fetch(base+'/api/stays/booking/'+booking.booking_code+'/document.pdf');assert.equal(guestPdf.status,200);
 assert.equal((await fetch(base+'/api/stays/booking/AQH-UNKNOWN123/document.pdf')).status,404);
 const docPage=await fetch(base+'/api/stays/booking/'+booking.booking_code+'/document');assert.equal(docPage.status,200);assert.match(docPage.headers.get('content-security-policy'),/default-src 'none'/);assert.match(await docPage.text(),/downloadBookingDocument/);
 const deliverySettings=`/api/office/hotels/${h.id}/booking-notifications`;
 assert.equal((await req(deliverySettings,null,null,'GET')).status,401);
 assert.equal((await req(deliverySettings,null,other.id,'GET')).status,404);
 let deliveryView=await req(deliverySettings,null,owner.id,'GET');
 assert.equal(deliveryView.cacheControl,'no-store');assert.equal(deliveryView.deliveries.length,2);
 assert.equal(deliveryView.deliveries[0].booking_id,booking.id);assert.equal(deliveryView.deliveries[0].status,'queued');
 assert.equal(deliveryView.deliveries.find(d=>d.audience==='manager').recipient,owner.email);assert.equal(deliveryView.deliveries.find(d=>d.audience==='guest').recipient,guest.email);assert.equal(deliveryView.email_connection.code,'NOT_CONFIGURED');
 const emptyHotel=(await db.query("INSERT INTO hotels(owner_id,name,slug,city,status) VALUES($1,'Other Hotel','delivery-empty','دمشق','active') RETURNING id",[owner.id])).rows[0];
 assert.deepEqual((await req(`/api/office/hotels/${emptyHotel.id}/booking-notifications`,null,owner.id,'GET')).deliveries,[]);
 await service.drain();assert.equal(sent.length,0);ready=true;failEmail=true;await service.drain();let job=(await db.query("SELECT * FROM hotel_notification_outbox WHERE channel='email'")).rows[0];assert.equal(job.status,'queued');assert.equal(job.attempts,1);
 deliveryView=await req(deliverySettings,null,owner.id,'GET');assert.equal(deliveryView.deliveries[0].attempts,1);assert.equal(deliveryView.deliveries[0].status,'queued');
 await db.query('UPDATE hotel_notification_outbox SET next_attempt_at=NOW()');failEmail=false;await service.drain();assert.equal(sent.length,2);assert.deepEqual(sent.map(j=>j.recipient).sort(),[owner.email,guest.email].sort());assert.ok(sent.every(j=>j.document_snapshot.status==='pending'));await service.drain();assert.equal(sent.length,2);ready=false;
 deliveryView=await req(deliverySettings,null,owner.id,'GET');assert.equal(deliveryView.deliveries[0].status,'sent');assert.ok(deliveryView.deliveries[0].sent_at);
 const decision='/api/office/hotel-bookings/'+booking.id;
 assert.equal((await req(decision,{status:'confirmed'},null,'PATCH')).status,401);
 assert.equal((await req(decision,{status:'confirmed'},other.id,'PATCH')).status,404);
 assert.equal((await req(decision,{status:'confirmed'},owner.id,'PATCH','https://foreign.example')).status,403);
 assert.equal((await req(decision,{status:'cancelled'},owner.id,'PATCH')).status,400);
 const accepted=await req(decision,{status:'confirmed',note:'أهلًا بك'},owner.id,'PATCH');assert.equal(accepted.data.status,'confirmed');assert.equal(accepted.data.approval_status,'approved');assert.equal(accepted.data.payment_status,'pending');
 assert.equal((await req(decision,{status:'confirmed'},owner.id,'PATCH')).repeated,true);
 const approvedEmails=(await db.query("SELECT * FROM hotel_notification_outbox WHERE booking_id=$1 AND channel='email' AND event_key LIKE '%:approved'",[booking.id])).rows;assert.equal(approvedEmails.length,2);assert.ok(approvedEmails.every(j=>j.document_snapshot.status==='confirmed'));assert.ok(sent.every(j=>j.document_snapshot.status==='pending'),'previous email attachments retain the event state');
 assert.equal((await db.query("SELECT COUNT(*)::int n FROM user_notifications WHERE user_id=$1 AND type='hotel_booking_approved'",[guest.id])).rows[0].n,1);
 assert.equal((await req(decision,{status:'pending'},owner.id,'PATCH')).status,400);
 const next=await req('/api/mobile/hotels/book',make());const nextRow=(await db.query('SELECT * FROM hotel_bookings WHERE booking_code=$1',[next.data.booking_code])).rows[0];
 const rejected=await req('/api/office/hotel-bookings/'+nextRow.id,{status:'cancelled',note:'الوحدة غير متاحة'},owner.id,'PATCH');assert.equal(rejected.data.status,'cancelled');assert.equal(rejected.data.approval_status,'rejected');
 assert.equal((await req('/api/office/hotel-bookings/'+nextRow.id,{status:'confirmed'},owner.id,'PATCH')).status,409);
 // A paid request still needs hotel approval, while an unpaid manual booking remains pending after approval.
 for(const paid of [true,false]){
  const r=await req('/api/mobile/hotels/book',make());const b=(await db.query('UPDATE hotel_bookings SET payment_method=\'shamcash_manual\',payment_status=$2 WHERE booking_code=$1 RETURNING *',[r.data.booking_code,paid?'paid':'pending'])).rows[0];
  const result=await req('/api/office/hotel-bookings/'+b.id,{status:'confirmed'},owner.id,'PATCH');assert.equal(result.data.status,paid?'confirmed':'pending');assert.equal(result.data.approval_status,'approved');
 }
 // Pending hotel approval can be withdrawn after the ordinary free-cancellation deadline.
 const cancel=await req('/api/mobile/hotels/book',make());await db.query("UPDATE hotel_bookings SET cancellation_deadline='2020-01-01' WHERE booking_code=$1",[cancel.data.booking_code]);
 const cancelled=await service.cancelGuest(cancel.data.booking_code,'غيرت الموعد');assert.equal(cancelled.data.status,'cancelled');assert.equal((await service.cancelGuest(cancel.data.booking_code)).repeated,true);
 assert.equal((await req('/api/office/hotel-bookings/'+cancelled.data.id,{status:'confirmed'},owner.id,'PATCH')).status,409);
 // Custom manager email belongs to this hotel; another hotel owner cannot change it.
 const setting='/api/office/hotels/'+h.id+'/booking-notifications';
 assert.equal((await req(setting,{email:'new-manager@example.test'},other.id,'PUT')).status,404);
 assert.equal((await req(setting,{email:'bad'},owner.id,'PUT')).status,400);
 assert.equal((await req(setting,{email:'new-manager@example.test'},owner.id,'PUT')).status,200);
 assert.equal((await req(setting,null,owner.id,'GET')).email,'new-manager@example.test');
 // Failed notification persistence rolls back the booking instead of creating an unnotified request.
 const broken=express();broken.use(express.json());mobile.register(broken,{pool,getCurrentUser:async()=>guest,syncHotel:async()=>{},bookingApproval:{enqueue:async()=>{throw Error('test rollback');}}});
 const brokenServer=broken.listen(0,'127.0.0.1');await new Promise(r=>brokenServer.once('listening',r));t.after(()=>new Promise(r=>brokenServer.close(r)));const badBody=make();
 const failed=await fetch('http://127.0.0.1:'+brokenServer.address().port+'/api/mobile/hotels/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(badBody)});assert.equal(failed.status,500);assert.equal((await db.query('SELECT * FROM hotel_bookings WHERE idempotency_key=$1',[badBody.idempotency_key])).rows.length,0);
});
