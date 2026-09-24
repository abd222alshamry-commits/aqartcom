'use strict';
// Read-only browser checks. Without MEDIA_QA_URL, serve local fixtures only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os');
const {execFileSync}=require('node:child_process'),express=require('express');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const output=process.env.MEDIA_QA_OUTPUT||path.join(os.tmpdir(),'aqartkom-media-qa');fs.mkdirSync(output,{recursive:true});
 const root=path.resolve(__dirname,'..');let server,base=process.env.MEDIA_QA_URL;
 if(!base){
  const video=path.join(output,'clip.webm');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=size=160x120:rate=12','-t','4','-c:v','libvpx','-b:v','120k','-an','-y',video]);
  const images=['/assets/property-interior.webp','/assets/property-building.webp','/assets/property-villa.webp'];
  const hotel={id:7,name:'فندق اختبار المعرض',city:'دمشق',images:[images[0]],videos:[],description:'بيانات محلية للاختبار فقط'};
  const room={id:19,name:'201',room_type:'double',price:80,currency:'USD',max_guests:2,images:[...images,images[0]+'?room=201'],videos:[{url:'/uploads/clip.webm',poster_url:images[0]}]};
  const app=express();app.get('/api/hotels',(req,res)=>res.json({data:[hotel]}));app.get('/api/hotels/7',(req,res)=>res.json({hotel,rooms:[room]}));
  app.get('/api/auth/me',(req,res)=>res.json({user:null}));app.get('/api/hotels/7/reviews',(req,res)=>res.json({data:[]}));app.get('/api/hotels/7/review-bookings',(req,res)=>res.status(401).json({error:'login'}));
  app.get('/uploads/clip.webm',(req,res)=>res.sendFile(video));app.use(express.static(root));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 }
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
 const results=[];
 try{
  for(const [name,width,height]of [['phone',390,844],['desktop',1365,900]]){
   const context=await browser.newContext({viewport:{width,height},locale:'ar-SY',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   if(!process.env.MEDIA_QA_URL)await page.route('https://**',route=>route.fulfill({status:200,contentType:'text/css',body:''}));
   await page.goto(base+'/hotels.html',{waitUntil:'domcontentloaded'});
   await page.locator('.hotel-open-photo[onclick="openHotel(7)"]').click();
   await page.waitForSelector('#hotelMedia .media-gallery-item');
   const count=await page.locator('#hotelMedia .media-gallery-item').count();assert.ok(count>=5,'Hotel and room images must be visible together');
   await page.locator('#hotelMedia [data-filter=image]').click();await page.locator('#hotelMedia .media-gallery-item').first().click();
   await page.waitForFunction(()=>{const img=document.querySelector('.media-image-stage>img');return img?.complete&&img.naturalWidth>0;});
   await page.locator('.media-image-tools button').filter({hasText:'التالية'}).click();assert.match(await page.locator('.media-image-tools span').textContent(),/^2 \/ /);
   await page.getByRole('button',{name:'تكبير الصورة',exact:true}).click();assert.equal(await page.locator('.media-image-stage').evaluate(el=>el.classList.contains('is-zoomed')),true);
   await page.getByRole('button',{name:'إظهار الصورة كاملة',exact:true}).click();
   await page.screenshot({path:path.join(output,name+'-image.png')});
   await page.goBack();await page.waitForSelector('.media-image-viewer',{state:'detached'});assert.equal(await page.locator('#modal').evaluate(el=>el.classList.contains('hidden')),false);
   await page.locator('#hotelMedia [data-filter=video]').click();
   if(!process.env.MEDIA_QA_URL){
    await page.locator('#hotelMedia .media-gallery-item').first().click();await page.waitForFunction(()=>document.querySelector('.property-video-viewer video')?.currentTime>0);
    await page.getByRole('button',{name:'إغلاق الفيديو',exact:true}).click();await page.waitForSelector('.property-video-viewer',{state:'detached'});
   }else assert.match(await page.locator('#hotelMedia').textContent(),/لا توجد فيديوهات مسجلة/);
   await page.locator('#hotelMedia [data-filter=all]').click();await page.screenshot({path:path.join(output,name+'-hotel.png')});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
   await page.locator('#close').click();assert.equal(await page.locator('#modal').evaluate(el=>el.classList.contains('hidden')),true);
   assert.deepEqual(errors,[]);results.push({viewport:name,mediaCount:count,errors});await context.close();
  }
  console.log(JSON.stringify({base,results}));
 }finally{await browser.close();if(server)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
