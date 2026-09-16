'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PGlite} = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const {seedDemoListings,batch} = require('../server/demo-listings');

test('demo import is opt-in, atomic, and does not recreate deleted listings', async () => {
  const db=new PGlite(); await db.waitReady;
  try {
    await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
    const pool={connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
    assert.equal((await seedDemoListings(pool,'')).created,0);
    assert.equal((await seedDemoListings(pool,batch)).created,10);
    const rows=(await db.query('SELECT * FROM properties')).rows;
    assert.equal(rows.length,10);
    for(const row of rows){
      assert.equal(row.is_demo,true);assert.equal(row.owner_id,null);
      assert.match(row.title,/إعلان تجريبي/);assert.match(row.description,/ليس عرضًا حقيقيًا/);
      assert.ok(Number.isFinite(Number(row.latitude))&&Number.isFinite(Number(row.longitude)));
      assert.ok(fs.existsSync(path.join(__dirname,'..',row.image_url)));
    }
    assert.equal((await seedDemoListings(pool,batch)).created,0);
    await db.query('DELETE FROM properties WHERE id=$1',[rows[0].id]);
    assert.equal((await seedDemoListings(pool,batch)).created,0);
    assert.equal((await db.query('SELECT COUNT(*)::int count FROM properties')).rows[0].count,9);
  } finally {await db.close();}
});
