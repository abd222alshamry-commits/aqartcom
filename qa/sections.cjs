// Isolated section smoke test: real PostgreSQL engine, no production writes.
const {PGlite}=require('@electric-sql/pglite');
const Module=require('module'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const db=new PGlite(); await db.waitReady;
 const query=async(sql,args)=>{const r=args?.length?await db.query(sql,args):await db.exec(sql);return Array.isArray(r)?r.at(-1)||{rows:[]}:r};
 const load=Module._load;let app,ready;const booted=new Promise(r=>ready=r);
 Module._load=function(id,...args){if(id==='pg')return {Pool:class{query(...a){return query(...a)}async connect(){return {query,release(){}}}}};const x=load.call(this,id,...args);if(id==='express'){function factory(){app=x();app.listen=()=>ready();return app}Object.assign(factory,x);return factory}return x};
 global.setInterval=()=>({unref(){}});global.setTimeout=(fn,ms,...args)=>ms>=1000?{unref(){}}:require('timers').setTimeout(fn,ms,...args);
 const realFetch=global.fetch;global.fetch=(url,opts)=>String(url).startsWith('http://127.0.0.1:')?realFetch(url,opts):Promise.reject(new Error('External calls disabled during QA'));
 process.env.ADMIN_EMAIL='qa@example.test';process.env.ADMIN_PASSWORD='Local-QA-only-2026!';process.env.NODE_ENV='test';process.env.API_RATE_LIMIT_PER_MINUTE='99999';
 process.env.DEMO_LISTINGS_BATCH='2026-09-16-ten-listings';
 require(root+'/server/server.js');await booted;
 const user=(await query("SELECT id,role FROM users WHERE email='qa@example.test'")).rows[0];
 require('node:assert/strict').equal(user.role,'admin');
 await query("INSERT INTO offices(owner_id,name,slug) VALUES($1,'QA Office','qa-office')",[user.id]);
 await query("UPDATE users SET office_id=1 WHERE id=$1",[user.id]);
 await query("INSERT INTO properties(owner_id,office_id,title,type,mode,city,price,area,latitude,longitude) VALUES($1,1,'QA Property','شقة','بيع','دمشق',100000,100,33.5,36.3),($1,1,'QA Property 2','شقة','بيع','دمشق',120000,120,33.51,36.31)",[user.id]);
 await query("INSERT INTO hotels(owner_id,office_id,name,slug,city,status) VALUES($1,1,'QA Hotel','qa-hotel','دمشق','active')",[user.id]);
 await query("INSERT INTO hotel_rooms(hotel_id,name,room_type,price) VALUES(1,'QA Room','double',100)");
 const token='qa-session-token',hash=require('crypto').createHash('sha256').update(token).digest('hex');await query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 day')",[user.id,hash]);
 const srv=require('http').createServer(app);await new Promise(r=>srv.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+srv.address().port;
 const headers={cookie:'aqartkom_session='+token,'content-type':'application/json'};
 const paths=[...new Set(app.router.stack.filter(s=>s.route?.methods.get).map(s=>s.route.path))];
 const results=[];
 for(const template of paths){const p=template.replace(/:slug/g,'qa-office').replace(/:provider/g,'booking').replace(/:[A-Za-z]+/g,'1');try{const r=await fetch(base+p,{headers,signal:AbortSignal.timeout(5000)});results.push({path:p,status:r.status,body:(await r.text()).slice(0,300)})}catch(e){results.push({path:p,error:e.message})}}
 for(const [p,body] of [['/api/admin/einvoices/auto-generate',{}],['/api/properties/compare',{ids:[1,2]}],['/api/property-matchmaker/match',{query:'شقة للبيع في دمشق'}]]){const r=await fetch(base+p,{method:'POST',headers,body:JSON.stringify(body)});results.push({path:p,status:r.status,body:(await r.text()).slice(0,500)})}

 const assert=require('node:assert/strict');
 async function post(p,body){const r=await fetch(base+p,{method:'POST',headers,body:JSON.stringify(body)});const text=await r.text();results.push({path:p,status:r.status,body:text.slice(0,500)});assert.ok(r.ok,p+': '+text);return JSON.parse(text)}
 await query('UPDATE hotels SET platform_commission_rate=10 WHERE id=1');
 const booking=await post('/api/hotels/book',{hotel_id:1,room_id:1,guest_name:'QA Guest',guest_phone:'000000000',guest_email:'guest@example.test',check_in:'2099-01-01',check_out:'2099-01-03'});
 assert.equal(Number(booking.data.total),200);
 const invoices=await post('/api/admin/einvoices/auto-generate',{});assert.equal(invoices.data.created,1);assert.equal(invoices.data.error_count,0);
 const repeat=await post('/api/admin/einvoices/auto-generate',{});assert.equal(repeat.data.created,0);
 await post('/api/hotel-bookings/'+booking.data.booking_code+'/cancel',{});
 const login=await post('/api/auth/login',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
 const unauth=await fetch(base+'/api/admin/einvoices');assert.equal(unauth.status,401);
 const publicListings=await fetch(base+'/api/properties').then(r=>r.json());
 assert.equal(publicListings.data.filter(p=>p.is_demo).length,0);
 const demos=(await query('SELECT id,status FROM properties WHERE is_demo=TRUE')).rows;assert.equal(demos.length,10);assert.ok(demos.every(p=>p.status==='rejected'));
 const demoDetails=await fetch(base+'/api/properties/'+demos[0].id);assert.equal(demoDetails.status,404);
 const demoInquiry=await fetch(base+'/api/properties/'+demos[0].id+'/inquiries',{method:'POST',headers,body:JSON.stringify({name:'QA visitor',message:'Should not be sent'})});assert.equal(demoInquiry.status,404);
 const badLocation=await fetch(base+'/api/properties',{method:'POST',headers,body:JSON.stringify({title:'QA invalid coordinates',type:'شقة',city:'دمشق',price:100,latitude:999,longitude:36})});assert.equal(badLocation.status,400);
 const geo=await fetch(base+'/api/properties/geo-search',{method:'POST',headers,body:JSON.stringify({center:{lat:33.501,lng:36.25},radiusKm:1})}).then(r=>r.json());assert.ok(geo.data.every(p=>!p.is_demo));
 const page=await fetch(base+'/');assert.match(page.headers.get('permissions-policy'),/geolocation=\(self\)/);

 const failures=results.filter(x=>x.status>=500&&!(x.path==='/api/me/push/public-key'&&x.status===503)||x.error);
 fs.writeFileSync(root+'/qa/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({tested:results.length,failures},null,2));srv.close();await db.close();process.exit(failures.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
