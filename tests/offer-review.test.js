'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const express=require('express'),{PGlite}=require('@electric-sql/pglite'),{JSDOM,VirtualConsole}=require('jsdom');
const permissions=require('../server/admin-permissions'),review=require('../server/offer-review');
const {registerOfficeListings,readOfficeListing,manualBatch}=require('../server/office-listings');
const root=path.resolve(__dirname,'..');
test('review and office creation permissions are distinct and cannot delegate or access money',()=>{
 const reviewer={role:'admin',admin_permissions:permissions.normalize(['offers.review'])};
 assert.deepEqual(reviewer.admin_permissions,['offers.read','offers.review']);
 for(const url of ['/api/admin/offers','/api/admin/offers/offices','/api/admin/offers/property/1'])assert.equal(permissions.allowed(reviewer,{method:'GET',path:url}),true);
 assert.equal(permissions.allowed(reviewer,{method:'POST',path:'/api/admin/offers/market/1/review'}),true);
 for(const [method,url] of [['POST','/api/admin/offers/office-listings'],['DELETE','/api/admin/offers/market/1'],['GET','/api/admin/offers/market/1/review'],['POST','/api/admin/team'],['PATCH','/api/admin/users/1'],['GET','/api/admin/finance/overview'],['GET','/api/office/hotels/1/bookings'],['GET','/api/admin/offers/credentials'],['POST','/api/admin/properties/1']])assert.equal(permissions.allowed(reviewer,{method,path:url}),false,url);
 const creator={role:'admin',admin_permissions:permissions.normalize(['offers.create'])};assert.equal(permissions.allowed(creator,{method:'POST',path:'/api/admin/offers/office-listings'}),true);assert.equal(permissions.allowed(creator,{method:'POST',path:'/api/admin/offers/hotel/1/review'}),false);
});

test('all offer types, office attribution, public visibility, audit, stale decisions and UI workflows',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());await db.exec(fs.readFileSync(root+'/server/db/schema.sql','utf8'));
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 const ids={};for(const [name,grants,role] of [['owner',null,'admin'],['reviewer',['offers.read','offers.review'],'admin'],['creator',['offers.read','offers.create'],'admin'],['supervisor',['offers.read','offers.review','offers.create'],'admin'],['reader',['offers.read'],'admin'],['ordinary',null,'user']])ids[name]=(await db.query('INSERT INTO users(name,email,password_hash,role,admin_permissions) VALUES($1,$2,\'unused\',$3,$4) RETURNING id',[name,name+'@test.invalid',role,grants?JSON.stringify(grants):null])).rows[0].id;
 const office=(await db.query("INSERT INTO offices(owner_id,name,slug,city,phone) VALUES($1,'مكتب الاختبار','test-office','دمشق','+963999999999') RETURNING id",[ids.ordinary])).rows[0].id;
 const source=(await db.query("INSERT INTO market_sources(platform,name,page_id) VALUES('facebook','مكتب مصدر','test-page') RETURNING id")).rows[0].id;
 const property=(await db.query("INSERT INTO properties(owner_id,office_id,title,type,mode,city,price,status) VALUES($1,$2,'شقة <img src=x onerror=alert(1)>','شقة','بيع','دمشق',100,'pending') RETURNING id",[ids.ordinary,office])).rows[0].id;
 const demo=(await db.query("INSERT INTO properties(title,type,mode,city,price,is_demo,status) VALUES('تجريبي','شقة','بيع','دمشق',1,TRUE,'pending') RETURNING id")).rows[0].id;
 const hotels=[];for(const kind of ['hotel','furnished_apartment','farm'])hotels.push((await db.query("INSERT INTO hotels(owner_id,name,slug,city,lodging_type) VALUES($1,$2,$2,'دمشق',$2) RETURNING id",[ids.ordinary,kind])).rows[0].id);
 await db.query("INSERT INTO hotel_rooms(hotel_id,name,room_type,price) VALUES($1,'غرفة اختبار','double',20)",[hotels[0]]);
 const unknown=(await db.query("INSERT INTO market_listings(source_id,platform,external_id,title,raw_data) VALUES($1,'facebook','unknown','Needs evidence',$2) RETURNING id",[source,JSON.stringify({secret:'not-for-reviewers',import_batch:'unverified'})])).rows[0].id;
 const app=express();app.use(express.json());
 app.use(async(req,_res,next)=>{req.user=(await db.query('SELECT * FROM users WHERE id=$1',[ids[req.headers['x-test-role']]||0])).rows[0]||null;next();});
 const requireAdmin=(req,res,next)=>!req.user||!req.user.is_active?res.status(401).json({error:'login required'}):permissions.allowed(req.user,req)?next():res.status(403).json({error:'permission denied'});
 review.register(app,{pool,requireAdmin});permissions.register(app,{pool,requireAdmin,bcrypt:{hash:async()=>'test-hash'},ownerEmail:'owner@test.invalid'});registerOfficeListings(app,pool);
 app.get('/api/auth/me',(req,res)=>res.json({user:req.user}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 async function call(url,role='supervisor',method='GET',body){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','x-test-role':role},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
 const detail=(kind,id,role='reviewer')=>call('/api/admin/offers/'+kind+'/'+id,role);
 const decide=async(kind,id,action,reason='',revision,role='reviewer')=>call('/api/admin/offers/'+kind+'/'+id+'/review',role,'POST',{action,reason,revision:revision||(await detail(kind,id,role)).body.revision});
 const payload={office:'office:'+office,title:'عرض مكتب يدوي',city:'دمشق',description:'عرض حقيقي للاختبار المحلي فقط',property_type:'شقة',listing_mode:'sale',price:'125000',rooms:3,currency:'USD',images:['https://example.test/photo.jpg']};
 let manual;
 await t.test('authorization, all sections and pagination',async()=>{
  assert.equal((await call('/api/admin/offers','anonymous')).status,401);assert.equal((await call('/api/admin/offers','ordinary')).status,403);
  let d=await call('/api/admin/offers','reader');assert.equal(d.status,200);assert.equal(d.body.total,6);assert.equal(d.body.can_review,false);assert.equal(d.body.can_create,false);
  assert.equal((await call('/api/admin/offers?kind=hotel','reviewer')).body.total,3);
  assert.equal((await call('/api/admin/offers?q='+encodeURIComponent('مكتب الاختبار'))).body.total,1);
  assert.equal((await call('/api/admin/offers?kind=constructor')).status,400);
  assert.equal((await detail('constructor',1,'owner')).status,404);
  assert.equal((await call('/api/admin/offers?page=2')).body.data.length,0);
  const data=(await detail('market',unknown)).body;assert.equal(data.data.raw_data,undefined);assert.equal(JSON.stringify(data).includes('not-for-reviewers'),false);
  assert.equal((await detail('hotel',hotels[0])).body.data.rooms.length,1);
 });
 await t.test('creator adds office-bound pending offers without approval or role escalation',async()=>{
  assert.equal((await call('/api/admin/offers/office-listings','reviewer','POST',payload)).status,403);
  assert.equal((await call('/api/admin/offers/office-listings','creator','POST',{...payload,office:'office:99999'})).status,404);
  for(const invalid of [{office:''},{images:['javascript:alert(1)']},{images:'https://test.invalid/x.jpg'},{phone:'bad-number'},{area:-1},{rooms:1.5},{price:true},{title:'x'.repeat(201)},{external_url:'http://example.test/x'}])assert.equal((await call('/api/admin/offers/office-listings','creator','POST',{...payload,...invalid})).status,400);
  const created=await call('/api/admin/offers/office-listings','creator','POST',{...payload,status:'published',raw_data:{import_batch:'forged'},advertiser_name:'forged',office_id:999});assert.equal(created.status,201);manual=created.body.data.id;
  const row=(await db.query('SELECT * FROM market_listings WHERE id=$1',[manual])).rows[0];assert.equal(row.status,'pending');assert.equal(Number(row.office_id),Number(office));assert.equal(row.advertiser_name,'مكتب الاختبار');assert.equal(row.phone,'+963999999999');assert.equal(row.raw_data.import_batch,manualBatch);
  assert.equal(await readOfficeListing(pool,manual),null);assert.equal((await decide('market',manual,'approve','',null,'creator')).status,403);
  const createdSource=await call('/api/admin/offers/office-listings','supervisor','POST',{...payload,office:'source:'+source,title:'عرض مصدر'});assert.equal(createdSource.status,201);assert.equal((await detail('market',createdSource.body.data.id)).body.data.office_name,'مكتب مصدر');
  assert.equal((await call('/api/admin/team','supervisor')).status,403);
 });
 await t.test('approval, rejection, pending and audit update publication atomically',async()=>{
  assert.equal((await decide('market',manual,'approve','تمت مطابقة بيانات المكتب')).status,200);
  let published=await readOfficeListing(pool,manual);assert.equal(published.advertiser_name,'مكتب الاختبار');assert.equal(published.platform,'manual_office');assert.equal(published.media.length,1);assert.match(published.source_published_at,/T.*Z$/);assert.equal(published.rooms,3);
  const options=(await call('/api/market/office-options','anonymous')).body.data;assert.ok(options.some(o=>o.key==='office-'+office&&o.name==='مكتب الاختبار'));
  const search=await require('../server/office-search').searchOfficeListings(pool,{rooms:'3',office:'office-'+office},async()=>1);assert.equal(search.length,1);assert.equal(search[0].rooms,3);
  assert.equal((await decide('market',manual,'reject')).status,400);assert.ok(await readOfficeListing(pool,manual));
  assert.equal((await decide('market',manual,'reject','البيانات غير مكتملة')).status,200);assert.equal(await readOfficeListing(pool,manual),null);
  let d=await detail('market',manual);assert.equal(d.body.history.length,3);assert.equal(d.body.history[0].actor_name,'reviewer');assert.equal(d.body.history[0].from_status,'published');assert.equal(d.body.history[0].reason,'البيانات غير مكتملة');
  assert.equal((await decide('market',manual,'pending','بانتظار تحديث المكتب')).status,200);
  const approved=await decide('market',unknown,'approve');assert.equal(approved.body.status,'approved');assert.equal(await readOfficeListing(pool,unknown),null);
  assert.equal((await decide('property',demo,'approve')).status,400);
  assert.equal((await decide('property',property,'approve')).body.status,'active');
  for(const hotel of hotels){assert.equal((await decide('hotel',hotel,'approve')).body.status,'active');assert.equal((await decide('hotel',hotel,'reject','طلب تحديث الصور')).body.status,'rejected');}
 });
 await t.test('stale reviews and content changes cannot overwrite later decisions',async()=>{
  const old=(await detail('property',property)).body.revision;
  assert.equal((await decide('property',property,'pending','مراجعة إضافية',old)).status,200);
  assert.equal((await decide('property',property,'approve','',old)).status,409);
  let revision=(await detail('property',property)).body.revision;
  await db.query('UPDATE properties SET description=$1 WHERE id=$2',['تعديل من المالك',property]);
  assert.equal((await decide('property',property,'approve','',revision)).status,409);
  revision=(await detail('property',property)).body.revision;await db.query('INSERT INTO property_images(property_id,url) VALUES($1,$2)',[property,'https://example.test/new.jpg']);
  assert.equal((await decide('property',property,'approve','',revision)).status,409);
  revision=(await detail('property',property)).body.revision;await db.query('UPDATE properties SET views_count=views_count+1 WHERE id=$1',[property]);assert.equal((await decide('property',property,'approve','',revision)).status,200);
  const hRevision=(await detail('hotel',hotels[0])).body.revision;await db.query('UPDATE hotel_rooms SET price=99 WHERE hotel_id=$1',[hotels[0]]);assert.equal((await decide('hotel',hotels[0],'approve','',hRevision)).status,409);
 });
 await t.test('audit failure rolls back the listing decision',async()=>{
  const before=(await detail('property',property)).body;
  await db.exec("ALTER TABLE offer_review_events ADD CONSTRAINT test_fail_audit CHECK (action<>'reject') NOT VALID");
  assert.equal((await decide('property',property,'reject','اختبار التراجع')).status,500);
  const after=(await detail('property',property)).body;assert.equal(after.data.status,before.data.status);assert.equal(after.history.length,before.history.length);
  await db.exec('ALTER TABLE offer_review_events DROP CONSTRAINT test_fail_audit');
 });
 async function domPage(name,role,url=''){
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(fs.readFileSync(root+'/'+name,'utf8'),{url:base+'/'+name+url,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
  const w=dom.window;w.HTMLElement.prototype.scrollIntoView=function(){};
  let requests=0;w.fetch=async(url,options={})=>{requests++;try{return await fetch(new URL(url,base),{...options,headers:{...options.headers,'x-test-role':role}});}finally{requests--;}};
  for(const s of w.document.querySelectorAll('script[src]'))w.eval(fs.readFileSync(root+new URL(s.src).pathname,'utf8'));
  const settle=async()=>{for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,15));if(!requests){await new Promise(r=>setTimeout(r,15));if(!requests)return;}}throw Error('DOM requests did not settle');};
  await settle();return {w,dom,errors,settle};
 }
 await t.test('supervisor DOM creates an office offer, previews it, approves and rejects it',async()=>{
  const p=await domPage('offer-review.html','supervisor');const doc=p.w.document;
  assert.equal(doc.getElementById('workspace').hidden,false);assert.equal(doc.getElementById('teamLink').hidden,true);assert.equal(doc.querySelector('#offers img'),null,'untrusted title stays text');
  doc.getElementById('newOffer').click();await p.settle();assert.equal(doc.getElementById('createPanel').hidden,false);
  const f=doc.getElementById('createForm');for(const [key,value] of Object.entries({...payload,title:'DOM office offer',images:payload.images.join('\n')}))f.elements[key].value=value;
  f.dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await p.settle();
  assert.equal(doc.getElementById('detailTitle').textContent,'DOM office offer');assert.match(doc.getElementById('detail').textContent,/بانتظار المراجعة/);
  assert.equal(doc.querySelector('#detail img').src,'https://example.test/photo.jpg');
  const decision=doc.getElementById('decisionForm');decision.dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await p.settle();assert.match(doc.getElementById('decisionMessage').textContent,/نشره/);assert.match(doc.getElementById('history').textContent,/supervisor/);
  decision.elements.action.value='reject';decision.elements.action.dispatchEvent(new p.w.Event('change'));assert.equal(decision.elements.reason.required,true);decision.elements.reason.value='إعادة تدقيق من المكتب';decision.dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await p.settle();assert.match(doc.getElementById('decisionMessage').textContent,/رفض/);assert.match(doc.getElementById('history').textContent,/إعادة تدقيق من المكتب/);
  assert.equal(p.errors.length,0);p.dom.window.close();
 });
 await t.test('team preset saves only selected moderator grants; read-only UI and revoked access',async()=>{
  const p=await domPage('admin-team.html','owner','?preset=office-supervisor'),doc=p.w.document;
  const selected=()=>[...doc.querySelectorAll('[name=permission]:checked')].map(c=>c.value).sort();assert.deepEqual(selected(),['offers.create','offers.read','offers.review']);
  doc.getElementById('reviewerOnly').click();assert.deepEqual(selected(),['offers.read','offers.review']);
  const f=doc.getElementById('teamForm');f.elements.name.value='New reviewer';f.elements.email.value='new-reviewer@test.invalid';f.elements.password.value='local-test-only-password';f.dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await p.settle();
  assert.deepEqual((await db.query("SELECT admin_permissions FROM users WHERE email='new-reviewer@test.invalid'")).rows[0].admin_permissions,['offers.read','offers.review']);assert.equal(p.errors.length,0);p.dom.window.close();
  const reader=await domPage('offer-review.html','reader');assert.equal(reader.w.document.getElementById('newOffer').hidden,true);reader.w.document.querySelector('#offers button').click();await reader.settle();assert.equal(reader.w.document.getElementById('decisionForm').hidden,true);reader.dom.window.close();
  const anon=await domPage('offer-review.html','anonymous');assert.equal(anon.w.document.getElementById('signIn').hidden,false);assert.equal(anon.w.document.getElementById('workspace').hidden,true);anon.dom.window.close();
  await db.query('UPDATE users SET is_active=FALSE WHERE id=$1',[ids.reviewer]);assert.equal((await call('/api/admin/offers','reviewer')).status,401);
 });
});
