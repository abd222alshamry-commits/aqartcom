'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom'),{PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),source=name=>fs.readFileSync(path.join(root,name),'utf8');
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
function page(t,name,query=''){
 const dom=new JSDOM(source(name+'.html'),{url:'https://qa.invalid/'+name+'.html'+query,runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());
 const w=dom.window;w.runScript=code=>vm.runInContext(code,dom.getInternalVMContext());w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 return w;
}
test('property shortcuts and deep links use the correct governorate and locality, and clear stale map filters',async t=>{
 const w=page(t,'index','?region=mashta'),calls=[];
 w.fetch=async url=>{calls.push(String(url));return {ok:true,json:async()=>({data:[],user:null})};};
 for(const file of ['syria-localities.js','location-picker.js','app.js'])w.runScript(source(file));await settle();
 let query=new URL(calls.filter(x=>x.startsWith('/api/properties?')).at(-1),'https://qa.invalid').searchParams;
 assert.equal(query.get('city'),'طرطوس');assert.equal(query.get('district'),'مشتى الحلو');
 w.runScript('geoSearch.lat=34;geoSearch.lng=36;geoSearch.polygon=[[34,36],[34,37],[35,36]]');
 w.document.querySelector('[data-priority-region=damascus]').click();await settle();
 query=new URL(calls.filter(x=>x.startsWith('/api/properties?')).at(-1),'https://qa.invalid').searchParams;
 assert.equal(query.get('city'),'دمشق');assert.equal(query.has('district'),false);assert.equal(query.has('lat'),false);
 assert.equal(w.document.querySelector('[data-priority-region=damascus]').getAttribute('aria-pressed'),'true');
 w.document.getElementById('all').click();await settle();assert.equal(new URL(w.location.href).searchParams.has('region'),false);
 for(const value of [undefined,null,'',NaN,Infinity,'bad'])assert.equal(w.recommendationLabel({personal_score:value}),'مقترح لك');
 assert.equal(w.recommendationLabel({personal_score:76}),'76% مناسب');
});
test('hotel search supports chalet and town links, visible failure messages, demo opt-in and ignores stale responses',async t=>{
 const w=page(t,'hotels','?region=mashta&lodging_type=chalet'),calls=[];
 const real={id:1,name:'شاليه اختبار محلي',city:'طرطوس',district:'مشتى الحلو',lodging_type:'chalet'},demo={id:2,name:'تجريبي — شاليه',slug:'aqartkom-demo-hotel-v1-chalet'};
 w.fetch=async url=>{calls.push(String(url));return {ok:true,json:async()=>({data:[real,demo]})};};
 for(const file of ['media-gallery.js','hotel-details.js','hotels.js'])w.runScript(source(file));await settle();
 const params=new URL(calls[0],'https://qa.invalid').searchParams;assert.equal(params.get('region'),'mashta');assert.equal(params.get('lodging_type'),'chalet');assert.equal(params.get('city'),'');
 assert.equal(w.document.querySelectorAll('#hotels .card').length,1);assert.match(w.document.querySelector('#hotels .meta').textContent,/شاليه/);
 const check=w.document.getElementById('includeDemo');check.click();await settle();assert.equal(w.document.querySelectorAll('#hotels .card').length,2);assert.match(calls.at(-1),/includeDemo=true/);
 let resolve;w.fetch=()=>new Promise(r=>{resolve=r;});const first=w.search();
 w.fetch=async()=>({ok:true,json:async()=>({data:[{...real,name:'نتيجة أحدث'}]})});await w.search();
 resolve({ok:true,json:async()=>({data:[real]})});await first;assert.match(w.document.getElementById('hotels').textContent,/نتيجة أحدث/);
 w.fetch=async()=>({ok:false,json:async()=>({error:'تعذر تحميل الإقامات'})});await w.search();assert.match(w.document.getElementById('hotelSearchStatus').textContent,/تعذر/);assert.equal(w.document.querySelectorAll('#hotels .card').length,0);
 w.document.getElementById('checkOut').value=w.document.getElementById('checkIn').value;await w.search();assert.match(w.document.getElementById('hotelSearchStatus').textContent,/تاريخ مغادرة/);
});
test('existing lodging constraint upgrades idempotently and preserves records',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());const schema=source('server/db/schema.sql');await db.exec(schema);
 await db.exec("ALTER TABLE hotels DROP CONSTRAINT hotels_lodging_type_check;ALTER TABLE hotels ADD CONSTRAINT hotels_lodging_type_check CHECK(lodging_type IN ('hotel','furnished_apartment','farm'));INSERT INTO hotels(name,slug,city,lodging_type) VALUES('Existing','existing','دمشق','farm')");
 const migration=schema.slice(schema.indexOf('-- Upgrade existing installations'));
 await db.exec(migration);await db.exec(migration);
 await db.exec("INSERT INTO hotels(name,slug,city,lodging_type) VALUES('Chalet','chalet','طرطوس','chalet')");
 assert.deepEqual((await db.query('SELECT lodging_type FROM hotels ORDER BY id')).rows.map(x=>x.lodging_type),['farm','chalet']);
 assert.equal(require('../sol-knowledge').parse('أريد شاليه في دمشق').type,'chalet');
});
