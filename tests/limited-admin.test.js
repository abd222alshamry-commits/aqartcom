'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {allowed,normalize,register}=require('../server/admin-permissions'),express=require('express'),{PGlite}=require('@electric-sql/pglite');
test('limited admin permissions deny unassigned routes, writes and delegation',()=>{
 const user={role:'admin',admin_permissions:['hotels.read']};
 assert.equal(allowed(user,{path:'/api/office/hotels',method:'GET'}),true);
 for(const [p,m] of [['/api/office/hotels','POST'],['/api/admin/team','POST'],['/api/admin/users/1','PATCH'],['/api/admin/unknown','GET'],['/api/office/members','POST'],['/api/office/hotels/1/payments/approve','POST']])assert.equal(allowed(user,{path:p,method:m}),false);
 assert.equal(allowed({role:'admin',admin_permissions:null},{path:'/api/admin/team',method:'POST'}),true);
 assert.equal(allowed({role:'user',admin_permissions:null},{path:'/api/office/hotels',method:'GET'}),false);
 assert.deepEqual(normalize(['hotels.write']),['hotels.read','hotels.write']);assert.throws(()=>normalize(['*']));
});
test('only full admins can create or change limited accounts; full owner stays protected',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
 const full=(await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Owner','owner@test.invalid','test','admin') RETURNING *")).rows[0];
 const app=express();app.use(express.json());const requireAdmin=(req,res,next)=>{req.user=req.headers['x-test-role']==='full'?full:{id:999,role:'admin',admin_permissions:['hotels.read']};if(!allowed(req.user,req))return res.status(403).json({error:'denied'});next();};
 register(app,{pool:db,requireAdmin,bcrypt:{hash:async()=> 'test-only-hash'},ownerEmail:full.email});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 async function call(method,url,body,role='full'){const r=await fetch('http://127.0.0.1:'+server.address().port+url,{method,headers:{'Content-Type':'application/json','x-test-role':role},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
 const body={name:'Limited',email:'limited@test.invalid',password:'test-password-123',permissions:['hotels.write']};
 assert.equal((await call('POST','/api/admin/team',body,'limited')).status,403);
 const created=await call('POST','/api/admin/team',body);assert.equal(created.status,201);assert.deepEqual(created.body.data.admin_permissions,['hotels.read','hotels.write']);assert.equal(created.body.data.password_hash,undefined);
 assert.equal((await call('POST','/api/admin/team',body)).status,409);
 assert.equal((await call('PATCH','/api/admin/team/'+full.id,{permissions:[],is_active:false})).status,403);
 const changed=await call('PATCH','/api/admin/team/'+created.body.data.id,{permissions:['hotels.read'],is_active:false});assert.equal(changed.status,200);assert.equal(changed.body.data.is_active,false);
 assert.equal((await db.query('SELECT count(*)::int n FROM admin_access_events')).rows[0].n,2);
 assert.equal((await db.query('SELECT admin_permissions FROM users WHERE id=$1',[full.id])).rows[0].admin_permissions,null);
});
