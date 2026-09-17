'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs').promises;
const path=require('node:path');
const os=require('node:os');
const {promisify}=require('node:util');
const run=promisify(require('node:child_process').execFile);
const vm=require('node:vm');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {data,regionalBatch,enabledBatch,seedOfficeListings,readOfficeListings,readOfficeListing,registerOfficeListings}=require('../server/office-listings');
const {searchOfficeListings}=require('../server/office-search');

async function database(t){
  const db=new PGlite();await db.waitReady;t.after(()=>db.close());
  await db.exec(await fs.readFile(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
  const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
  return {db,pool};
}
async function regional(db,platform,id,options={}){
  const raw={import_batch:regionalBatch,office_key:'regional-SY01',source_published_at:'2026-09-18T15:00:00.000Z',observed_at:'2026-09-18T20:00:00.000Z',availability:'unconfirmed',media_kind:'none',governorate_id:'SY01',locality_id:'SY0101',...options.raw};
  return (await db.query(`INSERT INTO market_listings(platform,external_id,external_url,title,advertiser_name,city,district,price,currency,status,raw_data)
    VALUES($1,$2,$3,$4,'مكتب الاختبار','دمشق','المزة',$5,$6,$7,$8) RETURNING id`,[platform,id,'https://www.'+platform+'.com/'+id,platform+' عقار',options.price??null,options.currency||'USD',options.status||'published',JSON.stringify(raw)])).rows[0].id;
}

test('public catalog includes every published regional platform beyond 25 items, keeps old details, and excludes other statuses and batches',async t=>{
  const {db,pool}=await database(t);await seedOfficeListings(pool,enabledBatch);
  const facebook=await regional(db,'facebook','regional-fb');
  const instagram=await regional(db,'instagram','regional-ig');
  const tiktok=await regional(db,'tiktok','regional-tt');
  const old=await regional(db,'instagram','regional-old',{raw:{source_published_at:'2020-01-01T12:00:00Z'}});
  for(let i=0;i<30;i++)await regional(db,'tiktok','newer-'+i);
  const hidden=[];
  for(const status of ['pending','approved','rejected','duplicate'])hidden.push(await regional(db,'facebook','status-'+status,{status}));
  hidden.push(await regional(db,'instagram','untrusted-batch',{raw:{import_batch:'unapproved-import'}}));
  await assert.rejects(()=>regional(db,'facebook','regional-fb'),/duplicate key/);
  const app=express();registerOfficeListings(app,pool);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port+'/api/market/';
  const response=await fetch(base+'offices'),json=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(json.data.length,59);assert.equal(json.observed_at,'2026-09-18T20:00:00.000Z');
  for(const id of [facebook,instagram,tiktok,old])assert.ok(json.data.some(p=>p.id===id));
  assert.deepEqual(new Set(json.data.map(p=>p.platform)),new Set(['facebook','instagram','tiktok']));
  assert.equal(json.data.at(-1).id,old);
  for(const row of json.data){assert.equal(row.raw_data,undefined);assert.ok(!hidden.includes(row.id));}
  const fb=json.data.find(p=>p.id===facebook);assert.equal(fb.media_kind,'none');assert.equal(fb.observed_at,'2026-09-18T20:00:00.000Z');
  assert.equal(json.data.find(p=>p.office_key==='marei').media_kind,'video');
  assert.equal((await readOfficeListings(pool,'regional-SY01')).length,34);
  assert.equal((await fetch(base+'listings/'+old).then(r=>r.json())).data.id,old);
  for(const id of hidden)assert.equal((await fetch(base+'listings/'+id)).status,404);
  assert.equal((await fetch(base+'listings/1 OR 1=1')).status,404);
  const sql=[];
  const direct=await readOfficeListing({query:(q,a)=>{sql.push(q);return db.query(q,a);}},old);
  assert.equal(direct.id,old);assert.equal(sql.length,1);assert.match(sql[0],/m\.id=\$3::bigint/);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM market_listings WHERE platform='facebook' AND external_id='regional-fb'")).rows[0].n,1);
});

test('search uses each actual source currency and preserves its observation date',async t=>{
  const {db,pool}=await database(t);
  await regional(db,'facebook','price-usd',{price:50,currency:'USD'});
  await regional(db,'instagram','price-eur',{price:100,currency:'EUR'});
  await regional(db,'tiktok','price-syp',{price:4000,currency:'SYP'});
  await regional(db,'tiktok','price-unknown',{raw:{observed_at:null}});
  const conversions=[];
  const rows=await searchOfficeListings(pool,{currency:'USD'},async(from,to)=>{conversions.push([from,to]);return {EUR:1.2,SYP:0.0001}[from];});
  assert.deepEqual(new Set(conversions.map(x=>x.join('/'))),new Set(['EUR/USD','SYP/USD']));
  assert.equal(rows.find(p=>p.currency==='EUR').price_display,120);
  assert.equal(rows.find(p=>p.currency==='SYP').price_display,0.4);
  assert.equal(rows.find(p=>p.title==='facebook عقار').price_display,50);
  assert.equal(rows.find(p=>p.price===null).price_display,null);
  for(const row of rows)assert.equal(row.observed_at,row.price===null?null:'2026-09-18T20:00:00.000Z');
});

test('regional cards preserve safe source links, display real dates and do not invent media or locations',async()=>{
  const window={};vm.runInNewContext(await fs.readFile(path.join(__dirname,'../office-card.js'),'utf8'),{window,URL});
  const card=window.officeListingCard;
  const basic={id:5,title:'عرض <script>alert(1)</script>',description:'<img src=x onerror=alert(1)>',advertiser_name:'" onclick="alert(1)',media_kind:'none',source_published_at:'2026-09-18T15:00:00Z',observed_at:'2026-09-18T20:00:00Z'};
  for(const [platform,label] of [['facebook','فيسبوك'],['instagram','إنستغرام'],['tiktok','تيك توك']]){
    const url='https://www.'+platform+'.com/example';
    const html=card({...basic,platform,external_url:url});
    assert.ok(html.includes('href="'+url+'"'));assert.ok(html.includes(label));
    assert.ok(html.includes('تاريخ المنشور:'));assert.ok(html.includes('رصد الإعلان:'));
    assert.ok(!html.includes('▶'));assert.ok(!html.includes('class="marei-preview"'));assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('مشتى الحلو'));assert.ok(!html.includes('مراجعة 16 سبتمبر 2026'));
    assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('href="javascript:'));
  }
  for(const url of ['http://www.facebook.com/x','https://www.facebook.com.evil.example/x','https://evil.instagram.com/x','https://www.tiktok.com@evil.example/x','https://user:pass@www.facebook.com/x','https://www.facebook.com:8000/x','https://constructor/x']){
    const html=card({...basic,external_url:url,detail_url:'javascript:alert(1)',id:'javascript:alert(2)'});
    assert.ok(!html.includes('class="marei-source"'),url);assert.ok(!html.includes('href="javascript:'));
  }
  for(const platform of ['instagram','tiktok']){
    const html=card({...basic,platform,external_url:'https://www.'+platform+'.com/video/123',media_kind:'video'});
    assert.ok(html.includes('type="button" class="marei-preview"'));assert.ok(html.includes('data-property-video='));assert.ok(!html.includes('data-video-external'));assert.ok(html.includes('▶'));assert.ok(!html.includes('<img'));
  }
  const stored='/uploads/office-'+('f'.repeat(32));
  const html=card({...basic,platform:'tiktok',external_url:'https://www.tiktok.com/video/123',hosted_video:{url:stored+'.mp4',poster:stored+'.jpg',duration:65}});
  assert.ok(html.includes('&quot;url&quot;:&quot;'+stored+'.mp4&quot;'));assert.ok(html.includes('src="'+stored+'.jpg"'));assert.ok(html.includes('▶'));assert.ok(!html.includes('data-video-external'));
});

test('admin video upload accepts published regional ads and excludes pending and unrelated batches',async t=>{
  const {db,pool}=await database(t);
  const published=await regional(db,'tiktok','regional-upload');
  const pending=await regional(db,'instagram','regional-pending',{status:'pending'});
  const other=await regional(db,'facebook','other-upload',{raw:{import_batch:'other'}});
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'regional-video-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const uploads=path.join(temp,'uploads');await fs.mkdir(uploads);
  const clip=path.join(temp,'video.mp4');
  await run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=128x96:r=12','-t','0.5','-c:v','libx264','-pix_fmt','yuv420p','-threads','1','-y',clip]);
  const app=express();app.use(express.json());
  require('../server/office-videos')(app,{pool,uploadDir:uploads,requireAdmin:(_req,_res,next)=>next()});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port+'/api/admin/office-videos/';
  async function upload(id){const form=new FormData();form.append('video',new Blob([await fs.readFile(clip)],{type:'video/mp4'}),'video.mp4');return fetch(base+id+'/upload',{method:'POST',body:form});}
  for(const id of [pending,other])assert.equal((await upload(id)).status,404);
  const response=await upload(published);assert.equal(response.status,201);const result=await response.json();
  assert.equal((await readOfficeListing(pool,published)).hosted_video.url,result.data.url);
  assert.match(result.data.url,/^\/uploads\/office-[a-f0-9]{32}\.mp4$/);
});
