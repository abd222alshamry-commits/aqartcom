'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile,execFileSync}=require('node:child_process');
const express=require('express'),{PGlite}=require('@electric-sql/pglite'),{register}=require('../server/hotel-media'),{allowed}=require('../server/admin-permissions');
test('hotel and room uploads validate files, store real video posters, and enforce access before upload',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hotel-media-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const db=new PGlite();await db.waitReady;t.after(()=>db.close());await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
 const h=(await db.query("INSERT INTO hotels(name,slug,city) VALUES('Test','media-test','دمشق') RETURNING id")).rows[0].id;
 const r=(await db.query("INSERT INTO hotel_rooms(hotel_id,name,room_type,price) VALUES($1,'Room','double',80) RETURNING id",[h])).rows[0].id;
 const source=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');const poster=new Function('path','execFile','fs',source.slice(source.indexOf('function createVideoPoster('),source.indexOf("app.use(require('./public-files')"))+';return createVideoPoster;')(path,execFile,fs);
 const pool={query:(...x)=>db.query(...x),connect:async()=>({query:(...x)=>db.query(...x),release(){}})};
 const app=express();app.use(express.json());const gate=(req,res,next)=>{if(!req.headers['x-test-role'])return res.status(401).json({error:'login'});req.user={role:'admin',admin_permissions:req.headers['x-test-role']==='read'?['hotels.read']:null};if(!allowed(req.user,req))return res.status(403).json({error:'denied'});req.office={};next();};
 register(app,{pool,requireOfficeMember:gate,ownedHotel:async id=>(await db.query('SELECT * FROM hotels WHERE id=$1',[id])).rows[0],uploadDir:dir,createVideoPoster:poster});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 async function upload(url,kind,bytes,name,type,role='full'){const body=new FormData();body.append(kind,new Blob([bytes],{type}),name);const response=await fetch(base+url,{method:'POST',headers:{'x-test-role':role},body});return {status:response.status,body:await response.json()};}
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVt0AAAAASUVORK5CYII=','base64'),url=`/api/office/hotels/${h}`;
 assert.equal((await upload(url+'/images','images',png,'image.png','image/png','')).status,401);
 assert.equal((await upload(url+'/images','images',png,'image.png','image/png','read')).status,403);
 assert.equal(fs.readdirSync(dir).length,0);
 assert.equal((await upload(url+'/images','images',Buffer.from('<html>bad</html>'),'bad.png','image/png')).status,400);
 assert.equal((await upload(url+'/images','images',png,'bad.html','image/png')).status,400);
 assert.equal((await upload(url+'/images','images',png,'image.png','image/png')).status,201);
 assert.equal((await upload(url+`/rooms/${r}/images`,'images',png,'room.png','image/png')).status,201);
 const fixture=path.join(dir,'fixture.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=64x64:d=1','-c:v','libx264','-pix_fmt','yuv420p','-y',fixture]);
 const video=await upload(url+`/rooms/${r}/videos`,'videos',fs.readFileSync(fixture),'room.mp4','video/mp4');assert.equal(video.status,201,JSON.stringify(video));assert.ok(video.body.data[0].poster_url);assert.ok(fs.statSync(path.join(dir,path.basename(video.body.data[0].poster_url))).size>0);
 const room=(await db.query('SELECT images,videos FROM hotel_rooms WHERE id=$1',[r])).rows[0];assert.equal(room.images.length,1);assert.equal(room.videos.length,1);
 const del=await fetch(base+url+`/rooms/${r}/media`,{method:'DELETE',headers:{'x-test-role':'full','Content-Type':'application/json'},body:JSON.stringify({kind:'videos',url:room.videos[0].url})});assert.equal(del.status,200);assert.equal((await db.query('SELECT videos FROM hotel_rooms WHERE id=$1',[r])).rows[0].videos.length,0);
 const published=await fetch(base+url+'/publication',{method:'PATCH',headers:{'x-test-role':'full','Content-Type':'application/json'},body:JSON.stringify({status:'active'})});assert.equal(published.status,200);assert.equal((await db.query('SELECT status FROM hotels WHERE id=$1',[h])).rows[0].status,'active');
});
