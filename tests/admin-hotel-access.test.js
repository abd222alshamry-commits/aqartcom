'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const express=require('express'),{PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
test('hotel administration works without an office; partner scope and login remain enforced',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
 const admin=(await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Admin','admin@test.invalid','unused','admin') RETURNING id")).rows[0].id;
 const agent=(await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Agent','agent@test.invalid','unused','agent') RETURNING id")).rows[0].id;
 const own=(await db.query("INSERT INTO hotels(owner_id,name,slug,city,status) VALUES($1,'Own','own','دمشق','active') RETURNING id",[agent])).rows[0].id;
 const other=(await db.query("INSERT INTO hotels(name,slug,city,status) VALUES('Other','other','دمشق','active') RETURNING id")).rows[0].id;
 const room=(await db.query("INSERT INTO hotel_rooms(hotel_id,name,room_type,price,quantity) VALUES($1,'Room','double',80,1) RETURNING id",[other])).rows[0].id;
 const middleware=source.slice(source.indexOf('async function requireOfficeMember('),source.indexOf('function officeSlug('));
 const access=source.slice(source.indexOf('async function ownedHotel('),source.indexOf('function dateValid('));
 const app=express();app.use(express.json());
 // Identity injection is confined to this local test harness; production uses session cookies.
 const getCurrentUser=async req=>req.headers['x-test-role']==='readonly'?{id:admin,role:'admin',admin_permissions:['hotels.read']}:req.headers['x-test-role']==='admin'?{id:admin,role:'admin'}:req.headers['x-test-role']==='agent'?{id:agent,role:'agent'}:req.headers['x-test-role']==='user'?{id:agent,role:'user'}:null;
 const office={id:null,owner_id:agent};const getOfficeForUser=async id=>id===agent?office:null;
 const routes=source.split('\n').filter(l=>l.startsWith("app.get('/api/office/hotels',")||l.startsWith("app.get('/api/office/hotels/:id/rooms',")||l.startsWith("app.patch('/api/office/hotel-rooms/:id',"));
 new Function('require','app','pool','getCurrentUser','getOfficeForUser',middleware+access+routes.join('\n')+"\napp.get('/api/office/other',requireOfficeMember,(req,res)=>res.json({ok:true}));")(require('node:module').createRequire(path.join(__dirname,'../server/server.js')),app,db,getCurrentUser,getOfficeForUser);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const origin='http://127.0.0.1:'+server.address().port;
 async function call(url,role,method='GET',body){const r=await fetch(origin+url,{method,headers:{'x-test-role':role,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,json:await r.json()};}
 assert.equal((await call('/api/office/hotels','')).status,401);
 assert.equal((await call('/api/office/hotels','user')).status,403);
 assert.equal((await call('/api/office/hotels','admin')).json.data.length,2);
 const scoped=await call('/api/office/hotels','agent');assert.deepEqual(scoped.json.data.map(h=>h.id),[own]);
 assert.equal((await call(`/api/office/hotels/${other}/rooms`,'agent')).status,404);
 assert.equal((await call(`/api/office/hotels/${other}/rooms`,'admin')).status,200);
 assert.equal((await call(`/api/office/hotel-rooms/${room}`,'agent','PATCH',{price:90})).status,404);
 assert.equal((await call(`/api/office/hotels/${other}/rooms`,'readonly')).status,200);
 assert.equal((await call(`/api/office/hotel-rooms/${room}`,'readonly','PATCH',{price:90})).status,403);
 assert.equal((await call(`/api/office/hotel-rooms/${room}`,'admin','PATCH',{price:90})).status,200);
 assert.equal((await call('/api/office/other','admin')).status,404); // No broad office bypass.
});
