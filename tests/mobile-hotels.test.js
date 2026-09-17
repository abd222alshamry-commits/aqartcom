'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { register, stay, totalFor, guest } = require('../server/mobile-hotels');

test('hotel requests reject invalid calendar dates, past dates, and fractional counts', () => {
  const b = {hotel_id:1,room_id:1,check_in:'2099-03-01',check_out:'2099-03-03',adults:2,rooms_count:1};
  assert.equal(stay(b).nights,2);
  for(const bad of [{check_in:'2099-02-30'}, {check_out:'2099-03-01'}, {check_in:'2020-01-01',check_out:'2020-01-03'}, {adults:1.5}, {rooms_count:0}]) assert.throws(()=>stay({...b,...bad}));
  assert.deepEqual(totalFor('125.50',2,2,'10'), {subtotal:502,total:451.8,discount:10});
  assert.throws(()=>guest({guest_name:'A',guest_phone:'1'}));
});

test('mobile booking quote and idempotent confirmation use real SQL transactions', async t => {
  const db = new PGlite(); await db.waitReady; t.after(()=>db.close());
  await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
  // The additive migration can run on an existing schema again.
  await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
  const pool = {query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
  const hid = (await db.query("INSERT INTO hotels(name,slug,city,status) VALUES('Test Hotel','test-hotel','دمشق','active') RETURNING id")).rows[0].id;
  const ids = [];
  for(let i=0;i<3;i++) ids.push((await db.query("INSERT INTO hotel_rooms(hotel_id,name,room_type,max_guests,price,currency,quantity) VALUES($1,$2,'double',2,100,'USD',$3) RETURNING id",[hid,'Room '+i,i===0?3:i===1?1:2])).rows[0].id);
  for(let i=0;i<2;i++) await db.query(`INSERT INTO hotel_bookings(booking_code,hotel_id,room_id,guest_name,guest_phone,check_in,check_out,nights,unit_price,subtotal,total) VALUES($1,$2,$3,'Test Guest','12345678',$4,$5,1,100,100,100)`,['SEED-'+i,hid,ids[0],i===0?'2099-03-01':'2099-03-02',i===0?'2099-03-02':'2099-03-03']);
  const app = express(); app.use(express.json()); const syncs=[];
  register(app,{pool,getCurrentUser:async()=>null,syncHotel:async(_,id)=>syncs.push(id)});
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); t.after(()=>new Promise(r=>server.close(r)));
  const origin='http://127.0.0.1:'+server.address().port;
  const fields={hotel_id:hid,room_id:ids[0],check_in:'2099-03-01',check_out:'2099-03-03',adults:2,rooms_count:2};
  const q = await (await fetch(origin+'/api/mobile/hotels/quote?'+new URLSearchParams(fields))).json();
  assert.equal(q.data.available,2); assert.equal(q.data.total,400); // non-overlapping reservations occupy only one room each night
  const body={...fields,room_id:ids[1],rooms_count:1,guest_name:'Test Guest',guest_phone:'12345678',guest_email:'',special_requests:'',expected_total:200,expected_currency:'USD',payment_method:'pay_at_hotel',idempotency_key:crypto.randomUUID()};
  async function book(b) { const r=await fetch(origin+'/api/mobile/hotels/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return {status:r.status,json:await r.json()}; }
  const first=await book(body); assert.equal(first.status,201,JSON.stringify(first));assert.equal(first.json.data.total,'200.00');assert.equal(first.json.data.payment_status,'pending');
  const repeat=await book(body);assert.equal(repeat.status,200);assert.equal(repeat.json.data.booking_code,first.json.data.booking_code);assert.equal(repeat.json.repeated,true);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotel_bookings WHERE idempotency_key=$1',[body.idempotency_key])).rows[0].n,1);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotel_invoices')).rows[0].n,1);
  assert.equal(syncs.length,1);
  assert.equal((await book({...body,special_requests:'different'})).status,409);
  assert.equal((await book({...body,idempotency_key:crypto.randomUUID()})).status,409); // capacity cannot be exceeded
  await db.query("INSERT INTO hotel_room_rates(room_id,start_date,end_date,price,currency) VALUES($1,'2099-03-01','2099-03-04',120,'USD')",[ids[2]]);
  const quotedRate=await (await fetch(origin+'/api/mobile/hotels/quote?'+new URLSearchParams({...fields,room_id:ids[2],rooms_count:1}))).json();assert.equal(quotedRate.data.total,240);
  const changed=await book({...body,room_id:ids[2],idempotency_key:crypto.randomUUID()});assert.equal(changed.status,409);assert.match(changed.json.error,/تغير السعر/);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotel_bookings WHERE room_id=$1',[ids[2]])).rows[0].n,0);
  await db.query('UPDATE hotel_room_rates SET min_nights=3 WHERE room_id=$1',[ids[2]]);
  const tooShort=await fetch(origin+'/api/mobile/hotels/quote?'+new URLSearchParams({...fields,room_id:ids[2],rooms_count:1}));assert.equal(tooShort.status,409);
});
