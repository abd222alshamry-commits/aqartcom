'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const express=require('express'),multer=require('multer');
const {createMediaStorage}=require('../server/media-storage');
const {publicMediaKeys}=require('../server/media-inventory');
const {register:registerProperty}=require('../server/property-uploads');
const {register:registerHotel}=require('../server/hotel-media');
const {PGlite}=require('@electric-sql/pglite');

const env={MEDIA_STORAGE_PROVIDER:'r2',R2_ACCOUNT_ID:'a'.repeat(32),R2_ACCESS_KEY_ID:'test-id',R2_SECRET_ACCESS_KEY:'test-secret',R2_BUCKET:'test-media',R2_PUBLIC_BASE_URL:'https://media.example.test'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVt0AAAAASUVORK5CYII=','base64');
class FakeS3 {
  objects=new Map();calls=[];failPut=false;badHead=false;
  async send(command) {
    const i=command.input,name=command.constructor.name;this.calls.push({name,input:i});
    if(name==='PutObjectCommand') {
      if(this.failPut)throw Error('offline');
      if(this.objects.has(i.Key)&&i.IfNoneMatch==='*')throw Object.assign(Error('exists'),{$metadata:{httpStatusCode:412}});
      const chunks=[];for await(const chunk of i.Body)chunks.push(chunk);
      const data=Buffer.concat(chunks);assert.equal(data.length,i.ContentLength);
      assert.equal(require('node:crypto').createHash('md5').update(data).digest('base64'),i.ContentMD5);
      this.objects.set(i.Key,{data,metadata:i.Metadata});return {};
    }
    if(name==='HeadObjectCommand') {
      const object=this.objects.get(i.Key);if(!object)throw Object.assign(Error('missing'),{name:'NotFound'});
      return {ContentLength:object.data.length+(this.badHead?1:0),Metadata:object.metadata};
    }
    if(name==='DeleteObjectCommand'){this.objects.delete(i.Key);return {};}
    if(name==='ListObjectsV2Command')return {Contents:[...this.objects].map(([Key,o])=>({Key,Size:o.data.length}))};
    throw Error(name);
  }
}
async function setup(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'r2-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const client=new FakeS3(),store=createMediaStorage({uploadDir:dir,env,client});
  const file=path.join(dir,'picture.png');await fs.writeFile(file,png);
  return {dir,client,store,file};
}
async function serve(t,app) {
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  return 'http://127.0.0.1:'+server.address().port;
}
test('R2 verifies streamed bytes and keeps staging until database commit; rollback deletes only new media',async t=>{
  const {client,store,file}=await setup(t);const batch=store.batch();
  assert.equal(await batch.add(file),'https://media.example.test/uploads/picture.png');
  assert.equal((await fs.stat(file)).size,png.length);assert.ok(client.objects.has('uploads/picture.png'));
  await batch.commit();await assert.rejects(fs.stat(file),{code:'ENOENT'});
  const again=path.join(path.dirname(file),'second.png');await fs.writeFile(again,png);const rollback=store.batch();await rollback.add(again);await rollback.rollback();
  assert.deepEqual([...client.objects.keys()],['uploads/picture.png']);
  const report=await store.usage();assert.equal(report.bytes,png.length);assert.equal(report.target_gb,1000);
});
test('failed storage or verification retains source and never overwrites a conflicting remote object',async t=>{
  const {client,store,file}=await setup(t);client.failPut=true;await assert.rejects(store.copy(file),/offline/);assert.equal((await fs.stat(file)).size,png.length);
  client.failPut=false;client.badHead=true;await assert.rejects(store.copy(file),/verification/);assert.equal(client.objects.size,0);
  client.badHead=false;await store.copy(file);assert.equal((await store.copy(file,{reuse:true})).created,false);
  await fs.writeFile(file,'different');await assert.rejects(store.copy(file,{reuse:true}),/refusing to overwrite/);await assert.rejects(store.copy(file),/exists/);assert.deepEqual(client.objects.get('uploads/picture.png').data,png);
});
test('path checks, external URL deletion and partial configuration fail safely',async t=>{
  const {store,dir,client}=await setup(t);
  await assert.rejects(store.copy(path.join(dir,'../private.pdf')),/outside/);
  await fs.symlink('/etc/hosts',path.join(dir,'escape.png'));await assert.rejects(store.copy(path.join(dir,'escape.png')),/regular file/);
  await store.remove('https://another.example/uploads/picture.png');await store.remove('/uploads/../private.png');assert.equal(client.calls.length,0);
  assert.throws(()=>createMediaStorage({uploadDir:dir,env:{MEDIA_STORAGE_PROVIDER:'r2'}}),/configuration incomplete/);
  assert.throws(()=>createMediaStorage({uploadDir:dir,env:{...env,R2_PUBLIC_BASE_URL:'https://bucket.r2.dev'}}),/custom-domain/);
});
test('legacy URLs retain local Range support and missing media redirects preserve HEAD and Range',async t=>{
  const {dir,store}=await setup(t);const app=express();app.use('/uploads',express.static(dir),store.redirectMissing);const base=await serve(t,app);
  const local=await fetch(base+'/uploads/picture.png',{headers:{Range:'bytes=0-7'}});assert.equal(local.status,206);assert.equal((await local.arrayBuffer()).byteLength,8);
  const moved=await fetch(base+'/uploads/moved.mp4',{method:'HEAD',headers:{Range:'bytes=0-7'},redirect:'manual'});assert.equal(moved.status,307);assert.equal(moved.headers.get('location'),env.R2_PUBLIC_BASE_URL+'/uploads/moved.mp4');
  assert.equal((await fetch(base+'/uploads/private.pdf',{redirect:'manual'})).status,404);
});
test('migration inventory selects only public media fields and excludes verification/payment documents',async()=>{
  const queries=[];
  const pool={query:async sql=>{queries.push(sql);if(sql.includes('FROM hotels'))return {rows:[{media:[{url:'/uploads/hotel.png'}],videos:[{url:'/uploads/tour.mp4',poster_url:'/uploads/tour.jpg'}]}]};if(sql.includes('FROM property_images'))return {rows:[{media:'https://site.example/uploads/property.png'},{media:'https://foreign.example/uploads/foreign.png'},{media:'/uploads/not-a-photo.pdf'}]};return {rows:[]};}};
  assert.deepEqual(await publicMediaKeys(pool,['https://site.example']),['uploads/hotel.png','uploads/property.png','uploads/tour.jpg','uploads/tour.mp4']);
  assert.ok(queries.every(q=>!q.includes('verification')&&!q.includes('payment')&&!q.includes('private')));
});
test('property and hotel routes commit remote URLs, roll back failed saves and reject unauthorized uploads before writing files',async t=>{
  const {dir,store,client}=await setup(t);await fs.unlink(path.join(dir,'picture.png'));
  const db=new PGlite();await db.waitReady;t.after(()=>db.close());await db.exec(await fs.readFile(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
  const user=(await db.query("INSERT INTO users(name,email,password_hash) VALUES('Owner','owner@test.example','hash') RETURNING id")).rows[0];
  const property=(await db.query("INSERT INTO properties(title,type,mode,city,price,owner_id) VALUES('Home','شقة','بيع','دمشق',10,$1) RETURNING id",[user.id])).rows[0];
  const hotel=(await db.query("INSERT INTO hotels(name,slug,city) VALUES('Hotel','r2-hotel','دمشق') RETURNING id")).rows[0];
  let failDb=false;
  const query=(sql,args)=>{if(failDb&&(/INSERT INTO property_images/.test(sql)||/UPDATE hotels SET images/.test(sql)))throw Error('database failure');return db.query(sql,args);};
  const pool={query,connect:async()=>({query,release(){}})};
  const app=express();app.use(express.json());
  const auth=(req,res,next)=>{if(req.headers['x-owner']!=='yes')return res.sendStatus(401);req.user={id:user.id};req.office={};next();};
  const upload=multer({storage:multer.diskStorage({destination:dir,filename:(_r,_f,cb)=>cb(null,require('node:crypto').randomUUID()+'.png')})}).array('images',12);
  registerProperty(app,{pool,requireAuth:auth,receiveImages:upload,receiveVideos:upload,createVideoPoster:async()=>null,uploadDir:dir,mediaStore:store});
  registerHotel(app,{pool,requireOfficeMember:auth,ownedHotel:async id=>(await db.query('SELECT * FROM hotels WHERE id=$1',[id])).rows[0],createVideoPoster:async()=>null,uploadDir:dir,mediaStore:store});
  const base=await serve(t,app);
  const post=async(route,authorized=true)=>{const body=new FormData();body.append('images',new Blob([png],{type:'image/png'}),'room.png');return fetch(base+route,{method:'POST',headers:authorized?{'x-owner':'yes'}:{},body});};
  const propertyRoute=`/api/me/properties/${property.id}/images`,hotelRoute=`/api/office/hotels/${hotel.id}/images`;
  assert.equal((await post(propertyRoute,false)).status,401);assert.deepEqual(await fs.readdir(dir),[]);
  assert.equal((await post('/api/me/properties/999999/images')).status,404);assert.deepEqual(await fs.readdir(dir),[]);
  for(const route of [propertyRoute,hotelRoute]) {const response=await post(route);assert.equal(response.status,201);const result=await response.json();assert.ok(result.data[0].url.startsWith(env.R2_PUBLIC_BASE_URL));}
  assert.equal(client.objects.size,2);assert.deepEqual(await fs.readdir(dir),[]);
  failDb=true;for(const route of [propertyRoute,hotelRoute])assert.ok((await post(route)).status>=400);
  assert.equal(client.objects.size,2);assert.deepEqual(await fs.readdir(dir),[]);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM property_images')).rows[0].n,1);
  client.failPut=true;failDb=false;assert.equal((await post(propertyRoute)).status,503);assert.equal(client.objects.size,2);
});
