'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {approximateLocation,withFallbackLocation}=require('../server/listing-location');
const {seedOfficeListings,enabledBatch,readOfficeListing}=require('../server/office-listings');
const mashta='sy-tartus-safita-mashta-elhiu-mashta-elhiu';

test('locality matching uses documented centers, stable IDs, and enough context to disambiguate repeated names',()=>{
  const located=approximateLocation({city:'طرطوس',district:'مشتى الحلو — الكورنيش'});
  assert.equal(located.locality_id,mashta);assert.equal(located.location_accuracy,'locality');
  assert.equal(located.latitude,34.876333);assert.equal(located.longitude,36.253671);
  assert.equal(located.location_radius_m,5000);assert.equal(located.location_approximate,true);
  const named=approximateLocation({city:'طرطوس',district:'مشتى الحلو — الكفرون'});
  assert.equal(named.locality_id,'sy-tartus-safita-mashta-elhiu-kafrun-mashta-elhiu');
  const ambiguous=approximateLocation({city:'طرطوس',district:'الكفرون — ملتقى النهرين'});
  assert.equal(ambiguous.location_accuracy,'governorate');assert.equal(ambiguous.locality_id,null);
  assert.equal(ambiguous.location_reason,'ambiguous_locality');assert.ok(ambiguous.location_radius_m>5000);
  assert.equal(approximateLocation({city:'طرطوس',district:'جبل مشتى الحلو'}).locality_id,mashta);
  const id=approximateLocation({raw_data:{governorate_id:'sy-tartus',locality_id:mashta},district:'اسم غير معروف'});
  assert.equal(id.locality_id,mashta);
  const conflict=approximateLocation({city:'حلب',governorate_id:'sy-tartus',locality_id:mashta});
  assert.equal(conflict.latitude,null);assert.equal(conflict.location_reason,'conflicting_governorate');
  const wrongProvince=approximateLocation({city:'حلب',locality_id:mashta});
  assert.equal(wrongProvince.location_accuracy,'governorate');assert.equal(wrongProvince.governorate_id,'sy-aleppo');
  const unknown=approximateLocation({city:'غير معروف',district:'مشتى الحلو',advertiser_name:'مكتب طرطوس'});
  assert.equal(unknown.latitude,null);assert.equal(unknown.longitude,null);
  assert.deepEqual(approximateLocation({city:'طرطوس',district:'مشتى الحلو — الكورنيش'}),located,'centers are stable, never randomized per listing');
});

test('owner coordinates are preserved while missing or invalid coordinates fall back only to documented geography',()=>{
  const owner={id:42,city:'طرطوس',district:'مشتى الحلو',latitude:'34.8780000',longitude:'36.2540000'};
  const supplied=withFallbackLocation(owner);
  assert.equal(supplied.latitude,owner.latitude);assert.equal(supplied.longitude,owner.longitude);
  assert.equal(supplied.location_approximate,false);assert.equal(supplied.location_accuracy,'provided');
  assert.equal(supplied.location_radius_m,null);
  for(const coords of [{latitude:null,longitude:null},{latitude:'',longitude:''},{latitude:999,longitude:999},{latitude:34.87,longitude:null}]){
    const result=withFallbackLocation({...owner,...coords});
    assert.equal(result.locality_id,mashta);assert.equal(result.location_approximate,true);assert.equal(result.latitude,34.876333);
  }
  const unknown=withFallbackLocation({city:'لا يعرف',district:'عنوان غير معروف'});
  assert.equal(unknown.latitude,null);assert.equal(unknown.longitude,null);
});

test('live geo route includes published office ads with approximate coordinates and excludes them from commute estimates',async t=>{
  const db=new PGlite();await db.waitReady;t.after(()=>db.close());
  await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
  const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
  await seedOfficeListings(pool,enabledBatch);
  const serverFile=path.join(__dirname,'../server/server.js'),source=fs.readFileSync(serverFile,'utf8');
  const start=source.indexOf('function pointInPolygon('),end=source.indexOf("app.get('/api/me/search-areas'",start);
  assert.ok(start>0&&end>start);
  const app=express();app.use(express.json());
  vm.runInNewContext(source.slice(start,end),{app,pool,getFxRate:async()=>1,require:createRequire(serverFile),console});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const query=async body=>{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/properties/geo-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,200);return response.json();
  };
  const all=await query({city:'طرطوس'});
  assert.equal(all.count,25);assert.equal(all.approximate_locations,true);
  assert.equal(all.data.filter(row=>row.location_accuracy==='locality').length,23);
  assert.equal(all.data.filter(row=>row.location_accuracy==='governorate').length,2);
  assert.ok(all.data.every(row=>row.location_approximate&&row.detail_url.startsWith('/office-property.html?id=')));
  const radius=await query({center:{lat:34.876333,lng:36.253671},radiusKm:5});
  assert.ok(radius.count>0&&radius.count<25);assert.ok(radius.data.every(row=>row.location_accuracy==='locality'));
  const polygon=await query({polygon:[[34.875,36.252],[34.878,36.252],[34.878,36.255],[34.875,36.255]]});
  assert.ok(polygon.count>0);assert.ok(polygon.data.every(row=>row.locality_id===mashta));
  assert.equal((await query({center:{lat:34.876333,lng:36.253671},commuteMinutes:60})).count,0);
  assert.equal((await query({rooms:3})).count,0);
  const first=all.data[0],detail=await readOfficeListing(pool,first.market_id);
  assert.equal(detail.latitude,first.latitude);assert.equal(detail.location_accuracy,first.location_accuracy);
  await db.query("UPDATE market_listings SET status='rejected' WHERE id=$1",[first.market_id]);
  assert.equal((await query({city:'طرطوس'})).count,24);
  await db.query(`INSERT INTO properties(title,type,mode,city,district,price,latitude,longitude)
    VALUES('owner pinpoint','شقة','بيع','طرطوس','مشتى الحلو',100,34.878,36.254),
    ('owner fallback','شقة','بيع','طرطوس','مشتى الحلو',200,NULL,NULL),
    ('owner unknown','شقة','بيع','مكان غير معروف','غير معروف',300,NULL,NULL)`);
  const owners=(await query({})).data.filter(row=>row.source_kind!=='office');
  assert.equal(owners.length,2);assert.ok(!owners.some(row=>row.title==='owner unknown'));
  const provided=owners.find(row=>row.title==='owner pinpoint');
  assert.equal(Number(provided.latitude),34.878);assert.equal(provided.location_approximate,false);
  const fallback=owners.find(row=>row.title==='owner fallback');
  assert.equal(fallback.location_approximate,true);assert.equal(fallback.locality_id,mashta);
  const commute=await query({center:{lat:34.876333,lng:36.253671},commuteMinutes:60});
  assert.equal(commute.count,1);assert.equal(commute.data[0].title,'owner pinpoint');
});

test('map groups shared approximate centers without hiding listings and keeps office links separate from owner comparisons',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../map-search.js'),'utf8');
  const fragment=source.slice(source.indexOf('function price(p)'),source.indexOf('function compare(id)'));
  const circles=[],pins=[],nodes={'#summary':{},'#results':{}};
  const L={divIcon:options=>options,circle:(point,options)=>({addTo(){circles.push({point,options});}}),marker:(point,options)=>({addTo(){pins.push({point,options});return this;},bindPopup(html){pins.at(-1).popup=html;}})};
  const basic={source_kind:'office',latitude:34.876333,longitude:36.253671,city:'طرطوس',location_accuracy:'locality',location_label:'مشتى الحلو',location_radius_m:5000,location_approximate:true,price:null};
  const context={L,markers:{clearLayers(){}},properties:[{...basic,id:'market-7',market_id:7,title:'أول <script>'},{...basic,id:'market-8',market_id:8,title:'ثانٍ'},{id:9,title:'مباشر',latitude:35,longitude:36,price:100,currency:'USD'}],esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),$:selector=>nodes[selector],updateCompare(){}};
  vm.runInNewContext(fragment+'\nrender();',context);
  assert.equal(circles.length,1);assert.equal(circles[0].options.radius,5000);assert.equal(pins.length,2);
  assert.match(pins[0].options.icon.html,/2 إعلان/);
  assert.match(pins[0].popup,/office-property\.html\?id=7/);assert.match(pins[0].popup,/office-property\.html\?id=8/);
  assert.match(pins[0].popup,/موقع تقريبي — ليس موقع العقار الدقيق/);
  assert.ok(!pins[0].popup.includes('<script>'));assert.ok(pins[0].popup.includes('&lt;script&gt;'));
  assert.match(nodes['#results'].innerHTML,/compare\(9\)/);assert.ok(!nodes['#results'].innerHTML.includes('compare(NaN)'));
  assert.match(nodes['#summary'].innerHTML,/100 USD/);assert.match(nodes['#results'].innerHTML,/السعر عند التواصل/);
});

test('owner detail distinguishes supplied points from approximate locality circles and has no map for unknown areas',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../property.js'),'utf8');
  const fragment=source.slice(source.indexOf('function hasPropertyLocation('),source.indexOf('async function load(){'));
  const markers=[],circles=[],map={setView(){return this;},fitBounds(){}};
  const context={document:{getElementById:()=>({})},addPropertyBasemaps(){},L:{map:()=>map,circle:(point,options)=>({addTo(){circles.push({point,options});return this;},getBounds:()=>[]}),marker:(point,options)=>({addTo(){markers.push({point,options});return this;},bindPopup(){}})},esc:value=>String(value??'').replace(/</g,'&lt;')};
  vm.createContext(context);vm.runInContext(fragment,context);
  const approximate=withFallbackLocation({title:'تقريبي',city:'طرطوس',district:'مشتى الحلو'});
  const provided=withFallbackLocation({title:'محدد',latitude:34.88,longitude:36.26});
  const html=context.propertyMapPanel(approximate);
  assert.match(html,/موقع تقريبي — ليس موقع العقار الدقيق/);assert.match(html,/فتح المنطقة التقريبية/);assert.match(html,/#map=12/);
  assert.ok(!context.propertyMapPanel(provided).includes('موقع تقريبي'));assert.match(context.propertyMapPanel(provided),/#map=15/);
  assert.ok(!context.propertyMapPanel(withFallbackLocation({city:'غير معروف'})).includes('id="propertyMap"'));
  context.initPropertyMap(approximate);context.initPropertyMap(provided);
  assert.equal(circles.length,1);assert.equal(circles[0].options.radius,5000);assert.equal(markers.length,2);
  assert.deepEqual(Array.from(markers[1].point),[34.88,36.26]);
});
