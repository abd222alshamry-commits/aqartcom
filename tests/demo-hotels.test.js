'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const demo=require('../server/demo-hotels');
const mobile=require('../server/mobile-hotels');

test('demo hotels require admin, preserve existing data, and work with the booking quote',async t=>{
  const db=new PGlite();await db.waitReady;t.after(()=>db.close());
  await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
  const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
  const owner=(await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Local Test Admin','demo@example.test','not-a-login','admin') RETURNING id")).rows[0];
  const other=(await db.query("INSERT INTO hotels(name,slug,city,status) VALUES('Unrelated hotel','unrelated-hotel','دمشق','active') RETURNING id")).rows[0];
  const app=express();app.use(express.json());
  // Test-only authorization fixture. Production passes the existing requireAdmin middleware.
  demo.register(app,{pool,requireAdmin:(req,res,next)=>{
    if(req.get('x-test-role')!=='admin')return res.status(req.get('x-test-role')?403:401).json({error:'Not authorized'});
    req.user=owner;next();
  }});
  mobile.register(app,{pool,getCurrentUser:async()=>null,syncHotel:async()=>{}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin='http://127.0.0.1:'+server.address().port;
  const request=(route='',method='POST',role='admin')=>fetch(origin+'/api/admin/demo-hotels'+route,{method,headers:role?{'x-test-role':role}:{}});
  for(const [route,method] of [['','GET'],['','POST'],['/hide','POST']]){
    assert.equal((await request(route,method,'')).status,401);
    assert.equal((await request(route,method,'user')).status,403);
  }
  const result=await(await request()).json();assert.equal(result.created,6);assert.equal(result.data.length,6);
  const initial=(await db.query('SELECT id,hotel_id,price FROM hotel_rooms ORDER BY id')).rows;assert.equal(initial.length,18);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotel_bookings')).rows[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotel_invoices')).rows[0].n,0);
  for(const h of result.data){
    const definition=demo.CATALOG.find(x=>x.city===h.city);
    const room=(await db.query("SELECT * FROM hotel_rooms WHERE hotel_id=$1 AND room_type='family'",[h.id])).rows[0];
    const q=await fetch(origin+'/api/mobile/hotels/quote?'+new URLSearchParams({hotel_id:h.id,room_id:room.id,check_in:'2099-03-01',check_out:'2099-03-03',adults:4,rooms_count:2}));
    assert.equal(q.status,200);assert.equal((await q.json()).data.total,definition.rooms[2].price*4);
  }
  await db.query('UPDATE hotel_rooms SET price=77 WHERE id=$1',[initial[0].id]);
  await db.query("INSERT INTO hotel_bookings(booking_code,hotel_id,room_id,guest_name,guest_phone,check_in,check_out,nights,unit_price,subtotal,total) VALUES('LOCAL-DEMO-TEST',$1,$2,'Local test','00000000','2099-04-01','2099-04-02',1,77,77,77)",[initial[0].hotel_id,initial[0].id]);
  const repeated=await(await request()).json();assert.equal(repeated.created,0);assert.equal(repeated.existing,6);
  assert.deepEqual((await db.query('SELECT id FROM hotel_rooms ORDER BY id')).rows.map(r=>r.id),initial.map(r=>r.id));
  assert.equal((await db.query('SELECT price FROM hotel_rooms WHERE id=$1',[initial[0].id])).rows[0].price,'77.00');
  assert.equal((await(await request('/hide')).json()).hidden,6);
  assert.equal((await db.query('SELECT status FROM hotels WHERE id=$1',[other.id])).rows[0].status,'active');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotel_bookings')).rows[0].n,1);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotel_rooms')).rows[0].n,18);
  assert.equal((await(await request('/hide')).json()).hidden,0);
  await request(); // Does not unexpectedly republish a hidden hotel.
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM hotels WHERE status='active'")).rows[0].n,1);
  await db.query('UPDATE hotels SET name=$1 WHERE id=$2',['Changed hotel',result.data[0].id]);
  assert.equal((await request()).status,409);
  assert.equal((await request('/hide')).status,409);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotels')).rows[0].n,7);
});

test('approved startup batch runs once and never recreates deleted demo data',async t=>{
  const db=new PGlite();await db.waitReady;t.after(()=>db.close());
  await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
  const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
  assert.equal((await demo.seedRequestedBatch(pool,'')).skipped,true);
  assert.equal((await demo.seedRequestedBatch(pool,'missing@example.test')).skipped,true);
  await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Admin','demo@example.test','not-a-login','admin'),('User','user@example.test','not-a-login','user')");
  assert.equal((await demo.seedRequestedBatch(pool,'user@example.test')).skipped,true);
  const realQuery=pool.query;
  const failingPool={...pool,connect:async()=>({query:(sql,args)=>sql.includes('INSERT INTO hotel_rooms')?Promise.reject(new Error('Simulated insert failure')):realQuery(sql,args),release(){}})};
  await assert.rejects(demo.seedRequestedBatch(failingPool,'demo@example.test'),/Simulated insert failure/);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotels')).rows[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM app_seed_runs WHERE key=$1',[demo.REQUESTED_BATCH])).rows[0].n,0);
  assert.equal((await demo.seedRequestedBatch(pool,'DEMO@example.test')).created,6);
  await demo.hide(pool);
  await db.query('DELETE FROM hotels WHERE slug=$1',[demo.CATALOG[0].slug]);
  assert.equal((await demo.seedRequestedBatch(pool,'demo@example.test')).skipped,true);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM hotels')).rows[0].n,5);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM hotels WHERE status='active'")).rows[0].n,0);
});
