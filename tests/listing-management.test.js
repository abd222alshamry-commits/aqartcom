'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const express=require('express'),{PGlite}=require('@electric-sql/pglite'),{JSDOM}=require('jsdom');
const management=require('../server/listing-management'),permissions=require('../server/admin-permissions');
const root=path.resolve(__dirname,'..'),source=name=>fs.readFileSync(path.join(root,name),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,80));
test('listing management authorization, edits, moderation, deletion and audit',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());await db.exec(source('server/db/schema.sql'));
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})},ids={};
 for(const [name,role,grants] of [['owner','admin',null],['editor','admin',['offers.edit']],['deleter','admin',['offers.delete']],['reviewer','admin',['offers.review']],['advertiser','user',null],['other','user',null],['office','agent',null]]){
  ids[name]=(await db.query('INSERT INTO users(name,email,password_hash,role,admin_permissions) VALUES($1,$2,\'unused\',$3,$4) RETURNING id',[name,name+'@test.invalid',role,grants?JSON.stringify(permissions.normalize(grants)):null])).rows[0].id;
 }
 const office=(await db.query("INSERT INTO offices(owner_id,name,slug) VALUES($1,'مكتب اختبار','listing-test') RETURNING id",[ids.office])).rows[0].id;
 const property=(await db.query("INSERT INTO properties(owner_id,title,type,mode,city,price,currency,rooms,status) VALUES($1,'شقة اختبار','شقة','بيع','دمشق',100,'USD',2,'active') RETURNING id",[ids.advertiser])).rows[0].id;
 const market=(await db.query("INSERT INTO market_listings(office_id,platform,external_id,title,city,listing_mode,property_type,currency,status) VALUES($1,'manual_office','test-ad','عرض مكتب','حمص','rent','شقة','USD','published') RETURNING id",[office])).rows[0].id;
 const hotel=(await db.query("INSERT INTO hotels(owner_id,name,slug,city,status) VALUES($1,'فندق اختبار','management-hotel','حلب','active') RETURNING id",[ids.advertiser])).rows[0].id;
 const room=(await db.query("INSERT INTO hotel_rooms(hotel_id,name,room_type,price) VALUES($1,'غرفة اختبار','double',100) RETURNING id",[hotel])).rows[0].id;
 const app=express();app.use(express.json());
 const getCurrentUser=async req=>(await db.query('SELECT * FROM users WHERE id=$1 AND is_active=TRUE',[ids[req.headers['x-user']]||0])).rows[0]||null;
 const requireAuth=async(req,res,next)=>{req.user=await getCurrentUser(req);if(!req.user)return res.status(401).json({error:'login'});next();};
 management.register(app,{pool,getCurrentUser,requireAuth});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 async function call(url='',user='owner',method='GET',body){const r=await fetch(base+'/api/listing-management'+url,{method,headers:{'x-user':user,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
 const detail=(kind,id,user='owner')=>call('/'+kind+'/'+id,user);
 const mutate=async(kind,id,user,method,changes,rev)=>call('/'+kind+'/'+id,user,method,{changes,revision:rev||(await detail(kind,id,user)).body.revision});
 await t.test('anonymous access denied, own and office scopes enforced, full administrator sees all',async()=>{
  assert.equal((await call('','anonymous')).status,401);
  assert.equal((await call('','owner')).body.total,3);
  assert.equal((await call('','advertiser')).body.total,2);assert.equal((await call('','office')).body.total,1);assert.equal((await call('','other')).body.total,0);
  assert.equal((await call('','reviewer')).body.total,0);
  assert.equal((await call('?kind=constructor','owner')).status,404);
  assert.equal((await detail('property',property,'other')).status,404);
  const revision=(await detail('property',property)).body.revision;
  assert.equal((await mutate('property',property,'other','PATCH',{title:'forged'},revision)).status,404);
  assert.equal((await mutate('property',property,'other','DELETE',{},revision)).status,404);
  assert.equal((await call('/capabilities','anonymous','POST',{items:[{kind:'property',id:property}]})).body.data.length,0);
  assert.equal((await call('/capabilities','other','POST',{items:[{kind:'property',id:property}]})).body.data.length,0);
  assert.equal((await call('/capabilities','advertiser','POST',{items:[{kind:'property',id:property},{kind:'market',id:market}]})).body.data.length,1);
 });
 await t.test('edit/delete grants remain distinct; rejected injections never change ownership or publication',async()=>{
  let d=await detail('property',property,'editor');assert.equal(d.status,200);
  assert.equal((await mutate('property',property,'editor','DELETE',{},d.body.revision)).status,404);
  assert.equal((await mutate('property',property,'deleter','PATCH',{title:'not permitted'},d.body.revision)).status,404);
  for(const changes of [{status:'active'},{owner_id:ids.other},{price:-1},{price:true},{rooms:1.5},{title:'x'.repeat(201)},{latitude:95},{latitude:33},{currency:'BAD'}])assert.equal((await mutate('property',property,'advertiser','PATCH',changes)).status,400,JSON.stringify(changes));
  assert.equal((await mutate('property',property,'editor','PATCH',{title:'عنوان معدل',price:250,rooms:0,latitude:33.5,longitude:36.3})).status,200);
  d=(await detail('property',property)).body;assert.equal(d.data.title,'عنوان معدل');assert.equal(d.data.rooms,0);assert.equal(Number(d.data.price),250);
  assert.equal((await db.query('SELECT owner_id FROM properties WHERE id=$1',[property])).rows[0].owner_id,ids.advertiser);
 });
 await t.test('optimistic concurrency, audit and market moderation preserve invariants',async()=>{
  const old=(await detail('property',property)).body.revision;
  await mutate('property',property,'advertiser','PATCH',{description:'تعديل جديد'});
  assert.equal((await mutate('property',property,'owner','PATCH',{title:'stale'},old)).status,409);
  assert.equal((await mutate('property',property,'owner','DELETE',{},old)).status,409);
  assert.equal((await mutate('market',market,'office','PATCH',{description:'معلومات جديدة من المكتب'})).body.status,'pending');
  assert.equal((await mutate('market',market,'owner','PATCH',{price:150})).body.status,'pending','content editing must not approve pending listings');
  const logs=(await db.query("SELECT * FROM offer_review_events WHERE kind='property' AND offer_id=$1 AND action='edit'",[property])).rows;assert.equal(logs.length,2);
 });
 await t.test('hotel editing advances terms revision, deletion retains room records and cannot be republished accidentally',async()=>{
  const before=(await db.query('SELECT terms_version FROM hotels WHERE id=$1',[hotel])).rows[0].terms_version;
  assert.equal((await mutate('hotel',hotel,'advertiser','PATCH',{rental_terms:'الشروط الجديدة'})).status,200);
  assert.equal((await db.query('SELECT terms_version FROM hotels WHERE id=$1',[hotel])).rows[0].terms_version,Number(before)+1);
  assert.equal((await mutate('hotel',hotel,'advertiser','DELETE',{})).status,200);
  assert.ok((await db.query('SELECT id FROM hotel_rooms WHERE id=$1',[room])).rows[0]);
  await db.query("UPDATE hotels SET status='active' WHERE id=$1",[hotel]);
  assert.equal((await db.query('SELECT status FROM hotels WHERE id=$1',[hotel])).rows[0].status,'inactive');
  assert.equal((await detail('hotel',hotel)).status,404);
 });
 await t.test('property and imported ad removal survives ingestion and disappears from management',async()=>{
  assert.equal((await mutate('property',property,'deleter','DELETE',{})).status,200);
  assert.equal((await mutate('market',market,'owner','DELETE',{})).status,200);
  for(const [table,id] of [['properties',property],['market_listings',market]]){
   await db.query(`UPDATE ${table} SET status=$1 WHERE id=$2`,[table==='properties'?'active':'published',id]);
   const row=(await db.query(`SELECT status,deleted_at FROM ${table} WHERE id=$1`,[id])).rows[0];assert.equal(row.status,'rejected');assert.ok(row.deleted_at);
  }
  assert.equal((await call()).body.total,0);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM offer_review_events WHERE action='delete'")).rows[0].n,3);
  // Applying the startup schema again must preserve removals and extended audit actions.
  await db.exec(source('server/db/schema.sql'));assert.equal((await call()).body.total,0);
 });
});

async function client(t,grant={can_edit:true,can_delete:true}){
 const dom=new JSDOM('<!doctype html><html dir="rtl"><body><header></header><div id="managedListings"><article id="card"><div data-listing-kind="property" data-listing-id="7" data-title="شقة دمشق"></div></article></div></body></html>',{url:'https://test.invalid/?private=secret',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,requests=[],data={id:7,title:'شقة دمشق',city:'دمشق',type:'شقة',mode:'بيع',price:100,currency:'USD',rooms:2,description:'وصف',latitude:null,longitude:null};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 w.fetch=async(url,options={})=>{requests.push({url,options});let body;
  if(url.endsWith('/capabilities'))body={data:grant?[{kind:'property',id:7,...grant}]:[]};
  else if(options.method)body={ok:true,message:'تم الحفظ'};
  else body={data,revision:'a'.repeat(64)};
  return {ok:true,json:async()=>body};
 };
 w.eval(source('listing-actions.js'));t.after(()=>w.close());await tick();return {w,doc:w.document,requests,data};
}
test('listing UI hides management for visitors, shares canonical URL, and handles clipboard failures',async t=>{
 const p=await client(t,null);assert.equal(p.doc.querySelector('[data-listing-edit]').hidden,true);
 let navigated=false;p.doc.getElementById('card').onclick=()=>navigated=true;p.doc.querySelector('[data-listing-share]').click();assert.equal(navigated,false);
 const url=p.doc.querySelector('.listing-share-url').value;assert.equal(url,'https://test.invalid/property.html?id=7');assert.ok(!url.includes('private'));
 assert.equal(new URL(p.doc.querySelector('.listing-whatsapp').href).searchParams.get('text'),'شقة دمشق\n'+url);
 p.doc.querySelector('[data-copy-link]').click();await tick();assert.match(p.doc.querySelector('[data-share-status]').textContent,/الرابط محدد/);
 Object.defineProperty(p.w.navigator,'clipboard',{value:{writeText:async text=>assert.equal(text,url)},configurable:true});
 p.doc.querySelector('[data-copy-link]').click();await tick();assert.match(p.doc.querySelector('[data-share-status]').textContent,/تم نسخ/);
});
test('edit form sends only changed fields, scoped revision, and rerendered cards retain controls',async t=>{
 const p=await client(t);assert.equal(p.doc.querySelector('[data-listing-edit]').hidden,false);
 p.doc.querySelector('[data-listing-edit]').click();await tick();
 p.doc.querySelector('input[name=price]').value='220';p.doc.querySelector('dialog form').dispatchEvent(new p.w.Event('submit',{cancelable:true}));await tick();
 const patch=p.requests.find(r=>r.options.method==='PATCH');assert.ok(patch);
 assert.deepEqual(JSON.parse(patch.options.body),{revision:'a'.repeat(64),changes:{price:'220'}});
 p.doc.getElementById('managedListings').innerHTML='<div data-listing-kind="property" data-listing-id="7"></div>';await tick();
 assert.equal(p.doc.querySelector('[data-listing-edit]').hidden,false);
});
test('delete requires a separate confirmation and cancel performs no mutation',async t=>{
 const p=await client(t);p.doc.querySelector('[data-listing-delete]').click();await tick();
 assert.equal(p.requests.some(r=>r.options.method==='DELETE'),false);p.doc.querySelector('[data-cancel]').click();await tick();
 assert.equal(p.requests.some(r=>r.options.method==='DELETE'),false);
 p.doc.querySelector('[data-listing-delete]').click();await tick();p.doc.querySelector('dialog form').dispatchEvent(new p.w.Event('submit',{cancelable:true}));await tick();
 const del=p.requests.find(r=>r.options.method==='DELETE');assert.equal(JSON.parse(del.options.body).revision,'a'.repeat(64));
});
test('management page signs in, lists permitted ads and exposes edit/delete/share',async t=>{
 const dom=new JSDOM(source('my-listings.html'),{url:'https://test.invalid/my-listings.html',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 t.after(()=>w.close());let user=null;
 w.fetch=async(url,options={})=>{
  let body;
  if(url==='/api/auth/me')body={user};
  else if(url==='/api/auth/login'){user={name:'مدير الاختبار',role:'admin',admin_permissions:null};body={user};}
  else if(url.endsWith('/capabilities'))body={data:[{kind:'property',id:3,can_edit:true,can_delete:true}]};
  else body={data:[{kind:'property',id:3,title:'شقة <img src=x>',city:'دمشق',status:'active',url:'/property.html?id=3'}],total:1,page:1,page_size:30};
  return {ok:true,json:async()=>body};
 };
 w.eval(source('listing-actions.js'));w.eval(source('my-listings.js'));await tick();
 assert.equal(w.document.getElementById('signIn').hidden,false);
 const form=w.document.getElementById('listingLogin');form.elements.email.value='test@example.test';form.elements.password.value='local-test';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();
 assert.equal(w.document.getElementById('workspace').hidden,false);assert.match(w.document.getElementById('listingCount').textContent,/1 إعلان/);
 assert.equal(w.document.querySelector('#managedListings img'),null);
 for(const name of ['share','edit','delete'])assert.equal(w.document.querySelector('[data-listing-'+name+']').hidden,false);
});
