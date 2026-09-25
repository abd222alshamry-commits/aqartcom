'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const express=require('express'),{PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
async function setup(t){
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 const users={};for(const name of ['host','other','guest','admin','limited'])users[name]=(await db.query("INSERT INTO users(name,email,password_hash,role,admin_permissions) VALUES($1,$2,'unused',$3,$4::jsonb) RETURNING id",[name,name+'@test.invalid',['admin','limited'].includes(name)?'admin':'user',name==='limited'?'["hotels.read"]':null])).rows[0].id;
 const app=express();app.use(express.json());
 // Local fixture identities only. Production resolves its session cookie with getCurrentUser.
 const getCurrentUser=async req=>(await db.query('SELECT * FROM users WHERE id=$1',[users[req.headers['x-test-user']]||0])).rows[0]||null;
 const requireAuth=async(req,res,next)=>{req.user=await getCurrentUser(req);if(!req.user)return res.status(401).json({error:'login'});next();};
 const middleware=source.slice(source.indexOf('async function requireOfficeMember('),source.indexOf('function officeSlug('));
 const helpers=source.slice(source.indexOf('async function ownedHotel('),source.indexOf("app.get('/api/hotels',"));
 const publicRoutes=source.slice(source.indexOf("app.get('/api/hotels',"),source.indexOf("app.post('/api/hotels/book',"));
 const officeRoutes=source.split('\n').filter(line=>/^app\.(get|post|patch)\('\/api\/office\/(hotels(?:'|\/:id(?:'|\/rooms'|\/bookings'))|hotel-rooms\/:id'|hotel-bookings\/:id')/.test(line)).join('\n');
 const access=new Function('require','app','pool','getCurrentUser','getOfficeForUser',middleware+helpers+publicRoutes+officeRoutes+';return {requireOfficeMember,ownedHotel};')(require('node:module').createRequire(path.join(__dirname,'../server/server.js')),app,pool,getCurrentUser,async()=>null);
 require('../server/host-portal').register(app,{pool,requireAuth,...access});
 require('../server/mobile-hotels').register(app,{pool,getCurrentUser,syncHotel:async()=>{}});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'host-uploads-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 require('../server/hotel-media').register(app,{pool,...access,uploadDir:dir,createVideoPoster:async()=>{throw Error('not used in image tests');}});
 for(const endpoint of ['/api/office/hotels/:id/commission','/api/office/hotels/:id/payments/entries','/api/office/other'])app.post(endpoint,access.requireOfficeMember,(req,res)=>res.json({ok:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const origin='http://127.0.0.1:'+server.address().port;
 async function call(url,user='',method='GET',body){const response=await fetch(origin+url,{method,headers:{'x-test-user':user,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,json:await response.json()};}
 async function enroll(user){assert.equal((await call('/api/hosts/enroll',user,'POST',{accepted:true})).status,200);}
 async function create(user,type='hotel'){const result=await call('/api/office/hotels',user,'POST',{name:user+' '+type,city:'دمشق',lodging_type:type});assert.equal(result.status,201,JSON.stringify(result));return result.json.data;}
 async function addRoom(id,user='host'){const result=await call(`/api/office/hotels/${id}/rooms`,user,'POST',{name:'Unit',room_type:'entire_unit',max_guests:4,quantity:2,price:100,currency:'USD'});assert.equal(result.status,201,JSON.stringify(result));return result.json.data;}
 return {db,users,call,enroll,create,addRoom,origin,dir};
}
const settings={lodging_type:'farm',check_in_time:'14:00',check_out_time:'12:00',free_cancel_hours:48,rental_terms:'لا يسمح بالتدخين داخل الوحدة',cancellation_policy:'راجع المالك بشأن أي تأمين قبل الحجز',terms_version:1};

test('self-service hosts own their pending properties and media without receiving administration privileges',async t=>{
 const {db,users,call,enroll,create,addRoom,origin,dir}=await setup(t);
 assert.equal((await call('/api/hosts/dashboard')).status,401);
 assert.equal((await call('/api/hosts/dashboard','host')).json.enrolled,false);
 assert.equal((await call('/api/hosts/enroll','host','POST',{accepted:false,role:'admin'})).status,400);
 assert.equal((await call('/api/office/hotels','host')).status,403);
 await enroll('host');await enroll('other');
 assert.equal((await db.query('SELECT role FROM users WHERE id=$1',[users.host])).rows[0].role,'user');
 const own=await create('host','farm'),other=await create('other','furnished_apartment');
 assert.equal(own.status,'pending');assert.equal(own.owner_id,users.host);const room=await addRoom(own.id);
 assert.deepEqual((await call('/api/hosts/dashboard','host')).json.data.map(h=>h.id),[own.id]);
 assert.deepEqual((await call('/api/office/hotels','host')).json.data.map(h=>h.id),[own.id]);
 assert.equal((await call(`/api/office/hotels/${other.id}/rooms`,'host')).status,404);
 assert.equal((await call(`/api/office/hotel-rooms/${room.id}`,'other','PATCH',{price:1})).status,404);
 for(const url of [`/api/office/hotels/${own.id}/commission`,`/api/office/hotels/${own.id}/payments/entries`,'/api/office/other'])assert.equal((await call(url,'host','POST',{})).status,403);
 assert.equal((await call(`/api/office/hotels/${own.id}/publication`,'host','PATCH',{status:'active'})).status,403);
 const stayUrl=`/api/office/hotels/${own.id}/stay-settings`;
 assert.equal((await call(stayUrl,'other','PATCH',settings)).status,404);
 await enroll('limited');assert.equal((await call(stayUrl,'limited','PATCH',settings)).status,403); // Enrollment never bypasses limited-admin grants.
 assert.equal((await call(stayUrl,'host','PATCH',{...settings,check_in_time:'25:00'})).status,400);
 assert.equal((await call(stayUrl,'host','PATCH',settings)).json.data.terms_version,2);
 assert.equal((await call(stayUrl,'host','PATCH',settings)).status,409);
 assert.equal((await call(`/api/office/hotels/${own.id}`,'host','PATCH',{check_out_time:'bad'})).status,400);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVt0AAAAASUVORK5CYII=','base64');
 async function upload(url,user){const form=new FormData();form.append('images',new Blob([png],{type:'image/png'}),'photo.png');return fetch(origin+url,{method:'POST',headers:{'x-test-user':user},body:form});}
 const imageUrl=`/api/office/hotels/${own.id}/images`;
 assert.equal((await upload(imageUrl,'other')).status,404);assert.equal(fs.readdirSync(dir).length,0);
 assert.equal((await upload(imageUrl,'host')).status,201);
 assert.equal((await upload(`/api/office/hotels/${own.id}/rooms/${room.id}/images`,'host')).status,201);
 assert.equal((await call('/api/hotels?lodging_type=farm')).json.data.length,0);
 assert.equal((await call(`/api/office/hotels/${own.id}/publication`,'admin','PATCH',{status:'active'})).status,200);
 assert.deepEqual((await call('/api/hotels?lodging_type=farm')).json.data.map(h=>h.id),[own.id]);
 assert.equal((await call('/api/hotels?lodging_type=furnished_apartment')).json.data.length,0);
 assert.equal((await call('/api/hotels?lodging_type=invalid')).status,400);
});

test('booking preserves accepted policy and calculates cancellation from Damascus arrival time',async t=>{
 const {db,call,enroll,create,addRoom}=await setup(t);await enroll('host');const h=await create('host'),r=await addRoom(h.id);
 const settingsUrl=`/api/office/hotels/${h.id}/stay-settings`;await call(settingsUrl,'host','PATCH',settings);await db.query("UPDATE hotels SET status='active' WHERE id=$1",[h.id]);
 const fields={hotel_id:h.id,room_id:r.id,check_in:'2099-03-10',check_out:'2099-03-13',adults:2,rooms_count:1};
 const q=(await call('/api/mobile/hotels/quote?'+new URLSearchParams(fields))).json.data;
 assert.match(q.cancellation_policy,/لا يسمح بالتدخين/);assert.equal(q.terms_version,2);assert.equal(q.stay_terms.free_cancel_hours,48);
 const body={...fields,guest_name:'Local Guest',guest_phone:'12345678',payment_method:'pay_at_hotel',expected_total:300,expected_currency:'USD',expected_terms_version:1,idempotency_key:crypto.randomUUID()};
 assert.equal((await call('/api/mobile/hotels/book','guest','POST',body)).status,409);
 body.expected_terms_version=2;const booking=await call('/api/mobile/hotels/book','guest','POST',body);assert.equal(booking.status,201,JSON.stringify(booking));
 assert.equal(booking.json.data.cancellation_deadline,'2099-03-08T11:00:00.000Z');assert.equal(booking.json.data.stay_terms_snapshot.rental_terms,settings.rental_terms);
 await call(settingsUrl,'host','PATCH',{...settings,terms_version:2,rental_terms:'شروط أحدث',free_cancel_hours:72});
 const repeat=await call('/api/mobile/hotels/book','guest','POST',body);assert.equal(repeat.status,200);assert.equal(repeat.json.data.stay_terms_snapshot.version,2);
 const saved=(await db.query('SELECT * FROM hotel_bookings WHERE booking_code=$1',[booking.json.data.booking_code])).rows[0];assert.equal(saved.stay_terms_snapshot.rental_terms,settings.rental_terms);
 assert.equal((await call(`/api/office/hotel-bookings/${saved.id}`,'host','PATCH',{status:'confirmed'})).status,403);
 assert.equal((await call(`/api/office/hotel-bookings/${saved.id}`,'host','PATCH',{status:'completed'})).status,404); // A future stay cannot be completed early.
 assert.equal((await call(`/api/office/hotel-bookings/${saved.id}`,'host','PATCH',{status:'cancelled'})).status,200);
});

test('only completed-date booking owners can review once; hosts can reply but cannot change ratings',async t=>{
 const {db,users,call,enroll,create,addRoom}=await setup(t);await enroll('host');await enroll('other');const h=await create('host'),other=await create('other'),room=await addRoom(h.id);await db.query("UPDATE hotels SET status='active'");
 async function stay(user,status='confirmed',future=false){return (await db.query("INSERT INTO hotel_bookings(booking_code,hotel_id,room_id,user_id,guest_name,guest_phone,check_in,check_out,nights,unit_price,subtotal,total,status) VALUES($1,$2,$3,$4,'Test Guest','12345678',$5,$6,1,100,100,100,$7) RETURNING id",[crypto.randomUUID(),h.id,room.id,users[user],future?'2099-03-01':'2020-03-01',future?'2099-03-02':'2020-03-02',status])).rows[0].id;}
 const valid=await stay('guest'),future=await stay('guest','confirmed',true),cancelled=await stay('guest','cancelled'),self=await stay('host');
 const url=`/api/hotels/${h.id}/reviews`,review={booking_id:valid,rating:4,title:'إقامة جيدة',body:'المكان نظيف ومريح'};
 assert.equal((await call(url,'','POST',review)).status,401);
 assert.deepEqual((await call(`/api/hotels/${h.id}/review-bookings`,'guest')).json.data.map(b=>b.id),[valid]);
 assert.equal((await call(url,'other','POST',review)).status,403);
 for(const booking_id of [future,cancelled])assert.equal((await call(url,'guest','POST',{...review,booking_id})).status,403);
 assert.equal((await call(url,'host','POST',{...review,booking_id:self})).status,403);
 assert.equal((await call(`/api/hotels/${other.id}/reviews`,'guest','POST',review)).status,403);
 assert.equal((await call(url,'guest','POST',{...review,rating:6})).status,400);
 const posted=await call(url,'guest','POST',review);assert.equal(posted.status,201,JSON.stringify(posted));
 assert.equal((await call(url,'guest','POST',review)).status,409);
 assert.equal((await call(`/api/hotels/${h.id}/review-bookings`,'guest')).json.data.length,0);
 const replyUrl=`/api/office/hotels/${h.id}/reviews/${posted.json.data.id}/reply`;
 assert.equal((await call(replyUrl,'other','PATCH',{reply:'رد'})).status,404);
 assert.equal((await call(replyUrl,'host','PATCH',{reply:'شكرًا لملاحظاتك',rating:5})).status,200);
 const publicReview=(await call(url)).json.data[0];assert.equal(publicReview.rating,4);assert.equal(publicReview.verified_stay,true);assert.equal(publicReview.host_reply,'شكرًا لملاحظاتك');
 for(const privateField of ['user_id','booking_id','booking_code','guest_email','guest_phone'])assert.equal(privateField in publicReview,false);
 const dashboard=(await call('/api/hosts/dashboard','host')).json.data[0];assert.equal(dashboard.review_count,1);assert.equal(Number(dashboard.review_score),4);
});

test('chalets can be created, reviewed, searched in Mashta and booked; demo stays are opt-in',async t=>{
 const {db,call,enroll,create,addRoom}=await setup(t);await enroll('host');
 const h=await create('host','chalet'),room=await addRoom(h.id);
 assert.equal(h.status,'pending');assert.equal(h.lodging_type,'chalet');
 assert.equal((await call('/api/hotels?lodging_type=chalet')).json.data.length,0);
 await db.query("UPDATE hotels SET city='طرطوس',district='مشتى الحلو',status='active' WHERE id=$1",[h.id]);
 const demo=(await db.query("INSERT INTO hotels(name,slug,city,status,lodging_type) VALUES('تجريبي — شاليه','aqartkom-demo-hotel-v1-chalet','دمشق','active','chalet') RETURNING id")).rows[0];
 assert.deepEqual((await call('/api/hotels?lodging_type=chalet')).json.data.map(x=>x.id),[h.id]);
 assert.equal((await call('/api/hotels?includeDemo=true&lodging_type=chalet')).json.data.length,2);
 assert.deepEqual((await call('/api/hotels?region=mashta&lodging_type=chalet')).json.data.map(x=>x.id),[h.id]);
 assert.equal((await call('/api/hotels?city='+encodeURIComponent('دمشق'))).json.data.length,0);
 assert.equal((await call('/api/hotels?checkIn=2099-03-12&checkOut=2099-03-10')).status,400);
 const fields={hotel_id:h.id,room_id:room.id,check_in:'2099-03-10',check_out:'2099-03-12',adults:2,rooms_count:1};
 const quote=(await call('/api/mobile/hotels/quote?'+new URLSearchParams(fields))).json.data;
 assert.equal(quote.total,200);
 const booked=await call('/api/mobile/hotels/book','guest','POST',{...fields,guest_name:'QA Chalet Guest',guest_phone:'12345678',payment_method:'pay_at_hotel',expected_total:quote.total,expected_currency:quote.currency,expected_terms_version:quote.terms_version,idempotency_key:crypto.randomUUID()});
 assert.equal(booked.status,201,JSON.stringify(booked));
 assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotels WHERE id=$1',[demo.id])).rows[0].n,1,'Hiding demos never deletes them');
});
