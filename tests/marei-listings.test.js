'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {batch,seedMareiListings,registerMareiListings}=require('../server/marei-listings');

async function database(t){
  const db=new PGlite();await db.waitReady;t.after(()=>db.close());
  await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
  return {db,pool:{query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})}};
}

test('source import preserves unknown facts, avoids duplicates, and respects removals',async t=>{
  const {db,pool}=await database(t);
  assert.equal((await seedMareiListings(pool,'')).created,0);
  assert.equal((await seedMareiListings(pool,batch)).created,7);
  const rows=(await db.query('SELECT * FROM market_listings')).rows;
  for(const row of rows){
    assert.equal(row.price,null);assert.equal(row.phone,null);assert.equal(row.property_id,null);
    assert.equal(row.latitude,null);assert.deepEqual(row.media,[]);
    assert.equal(row.status,'published');assert.equal(row.raw_data.availability,'unconfirmed');
    assert.equal(new URL(row.external_url).hostname,'www.facebook.com');
    assert.ok(row.external_url.includes('/100069723124560/videos/'));
  }
  assert.equal(rows.find(x=>x.raw_data.offer_number===367).area,null);
  assert.equal((await db.query('SELECT is_active FROM market_sources')).rows[0].is_active,false);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM properties')).rows[0].n,0);
  await db.query('DELETE FROM market_listings WHERE id=$1',[rows[0].id]);
  await db.query("UPDATE market_listings SET status='rejected' WHERE id=$1",[rows[1].id]);
  assert.equal((await seedMareiListings(pool,batch)).created,0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM market_listings')).rows[0].n,6);
});

test('public endpoint publishes reviewed office references only and exposes no raw data',async t=>{
  const {db,pool}=await database(t);await seedMareiListings(pool,batch);
  const app=express();registerMareiListings(app,pool);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const endpoint='http://127.0.0.1:'+server.address().port+'/api/market/marei';
  let response=await fetch(endpoint),json=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(json.data.length,7);assert.equal(json.availability,'unconfirmed');
  assert.equal(json.data[0].offer_number,'367');
  assert.equal(json.data[0].raw_data,undefined);assert.equal(json.data[0].phone,undefined);
  await db.query("UPDATE market_listings SET status='rejected' WHERE id=$1",[json.data[0].id]);
  await db.query("INSERT INTO market_listings(platform,external_id,title,status) VALUES('facebook','unreviewed','Pending','pending'),('facebook','another-office','Other office','published')");
  json=await fetch(endpoint).then(r=>r.json());assert.equal(json.data.length,6);
  assert.ok(json.data.every(x=>x.offer_number!=='367'));
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
