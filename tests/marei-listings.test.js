'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {batch,seedMareiListings,registerMareiListings}=require('../server/marei-listings');
const {data}=require('../server/office-listings');

async function database(t){
  const db=new PGlite();await db.waitReady;t.after(()=>db.close());
  await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
  return {db,pool:{query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})}};
}

test('five offices import five sourced ads each, keep unknown facts and respect removals',async t=>{
  const {db,pool}=await database(t);
  assert.equal((await seedMareiListings(pool,'')).created,0);
  assert.equal((await seedMareiListings(pool,batch)).created,25);
  const rows=(await db.query('SELECT * FROM market_listings')).rows;
  for(const row of rows){
    assert.equal(row.property_id,null);assert.equal(row.latitude,null);
    assert.equal(row.status,'published');assert.equal(new URL(row.external_url).hostname,'www.facebook.com');
    assert.match(row.phone,/^\+963\d+$/);
    assert.equal(row.media.length,1);
    assert.ok(fs.existsSync(path.join(__dirname,'..',row.media[0].url)));
  }
  assert.equal(rows.filter(x=>x.raw_data.availability==='sold').length,6);
  for(const office of data.offices)assert.equal(rows.filter(x=>x.raw_data.office_key===office.key).length,5);
  assert.ok(rows.filter(x=>x.raw_data.office_key==='marei').every(x=>x.price===null));
  assert.equal(rows.find(x=>x.raw_data.office_key==='marei'&&x.raw_data.offer_number===367).area,null);
  assert.equal(rows.find(x=>x.raw_data.office_key==='nabaa'&&x.raw_data.offer_number===492).price,null);
  assert.equal(Number(rows.find(x=>x.raw_data.office_key==='nabaa'&&x.raw_data.offer_number===493).price),35000);
  const sources=(await db.query('SELECT is_active FROM market_sources')).rows;
  assert.equal(sources.length,5);assert.ok(sources.every(x=>x.is_active===false));
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM properties')).rows[0].n,0);
  await db.query('DELETE FROM market_listings WHERE id=$1',[rows[0].id]);
  await db.query("UPDATE market_listings SET status='rejected' WHERE id=$1",[rows[1].id]);
  assert.equal((await seedMareiListings(pool,batch)).created,0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM market_listings')).rows[0].n,24);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM market_listings WHERE status='rejected'")).rows[0].n,1);
});

test('public endpoints expose only published reviewed ads and preserve office ordering',async t=>{
  const {db,pool}=await database(t);await seedMareiListings(pool,batch);
  const app=express();registerMareiListings(app,pool);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port+'/api/market/';
  let response=await fetch(base+'offices'),json=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(json.data.length,25);assert.equal(json.offices.length,5);
  assert.equal(json.data[0].raw_data,undefined);
  const marei=await fetch(base+'marei').then(r=>r.json());
  assert.equal(marei.data.length,5);assert.equal(marei.data[0].offer_number,'370');
  await db.query("UPDATE market_listings SET status='rejected' WHERE id=$1",[json.data[0].id]);
  await db.query("INSERT INTO market_listings(platform,external_id,title,status) VALUES('facebook','unreviewed','Pending','pending'),('facebook','another-office','Other office','published')");
  json=await fetch(base+'offices').then(r=>r.json());assert.equal(json.data.length,24);
});

test('upgrade refreshes old ads without republishing rejected ads and records legacy sold status',async t=>{
  const {db,pool}=await database(t);
  await db.query('INSERT INTO app_seed_runs(key) VALUES($1)',[batch]);
  await db.query("INSERT INTO market_listings(platform,external_id,title,status,raw_data) VALUES('facebook','1810607023405847','Old 367','rejected',$1),('facebook','1027851283381825','Old 364','published',$1)",[JSON.stringify({import_batch:batch,availability:'unconfirmed'})]);
  await seedMareiListings(pool,batch);
  const rows=(await db.query('SELECT * FROM market_listings')).rows;
  assert.equal(rows.length,26);
  assert.equal(rows.find(x=>x.external_id==='1810607023405847').status,'rejected');
  assert.equal(rows.find(x=>x.external_id==='1810607023405847').raw_data.import_batch,data.snapshot);
  assert.equal(rows.find(x=>x.external_id==='1027851283381825').raw_data.availability,'sold');
});

test('failed import rolls back its source, listings, and completion marker',async t=>{
  const {db}=await database(t);let inserts=0;
  const pool={connect:async()=>({release(){},async query(sql,args){
    if(sql.includes('INSERT INTO market_listings')&&++inserts===3)throw Error('injected failure');
    return db.query(sql,args);
  }})};
  await assert.rejects(()=>seedMareiListings(pool,batch),/injected failure/);
  for(const table of ['market_sources','market_listings','app_seed_runs']){
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM '+table)).rows[0].n,0);
  }
});
