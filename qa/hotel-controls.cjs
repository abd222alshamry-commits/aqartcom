// Actual application HTTP routes + form event handlers, using an isolated PostgreSQL database.
// JSDOM emulates DOM events and the narrow-screen menu; this is not a device/browser test.
'use strict';
const {JSDOM,VirtualConsole}=require('jsdom'),{PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module'),timers=require('node:timers'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>timers.setTimeout(r,ms));
(async()=>{
 const db=new PGlite();await db.waitReady;
 const query=async(sql,args)=>{const r=args?.length?await db.query(sql,args):await db.exec(sql);return Array.isArray(r)?r.at(-1)||{rows:[]}:r;};
 const originalLoad=Module._load;let app,ready;const booted=new Promise(r=>ready=r);
 Module._load=function(id,...args){if(id==='pg')return {Pool:class{query(...a){return query(...a)}async connect(){return {query,release(){}}}}};const item=originalLoad.call(this,id,...args);if(id==='express'){function factory(){app=item();app.listen=()=>ready();return app}Object.assign(factory,item);return factory}return item;};
 global.setInterval=()=>({unref(){}});global.setTimeout=(fn,ms,...args)=>ms>=1000?{unref(){}}:timers.setTimeout(fn,ms,...args);
 const realFetch=global.fetch;global.fetch=(url,opts)=>String(url).startsWith('http://127.0.0.1:')?realFetch(url,opts):Promise.reject(Error('External requests disabled for QA'));
 Object.assign(process.env,{ADMIN_EMAIL:'hotel-controls@qa.invalid',ADMIN_PASSWORD:'Local-QA-only-2026!',NODE_ENV:'test',API_RATE_LIMIT_PER_MINUTE:'99999',MEDIA_STORAGE_PROVIDER:'local'});
 require(root+'/server/server.js');await booted;
 const server=require('http').createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const login=await realFetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const errors=[],calls=[],uploaded=[],checks=[];let pending=0;
 const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync(root+'/hotel-partner.html','utf8'),{url:base+'/hotel-partner.html',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});const w=dom.window;
 const unexpected=e=>errors.push(String(e.stack||e));process.on('unhandledRejection',unexpected);
 w.matchMedia=()=>({matches:true,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};w.alert=message=>errors.push('Unexpected alert: '+message);w.confirm=()=>false;
 w.fetch=async(url,options={})=>{
  pending++;try{
   let body=options.body;
   if(body instanceof w.FormData){const data=new FormData();for(const [key,value] of body){if(typeof value==='string')data.append(key,value);else{const bytes=await new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsArrayBuffer(value);});data.append(key,new Blob([bytes],{type:value.type}),value.name);}}body=data;}
   const response=await realFetch(new URL(url,base),{...options,body,headers:{cookie,...options.headers}});calls.push({path:String(url),status:response.status});return response;
  }finally{pending--;}
 };
 async function settle(){for(let i=0;i<150;i++){await pause(10);if(!pending){await pause(20);if(!pending)return;}}throw Error('Requests did not settle');}
 function form(){return w.document.querySelector('#modalBody form');}
 function fields(values,target=form()){for(const [name,value] of Object.entries(values))target.elements[name].value=value;return target;}
 async function submit(target=form()){target.querySelector('button').click();await settle();}
 async function tab(name){const button=w.document.querySelector('[data-tab="'+name+'"]');const menu=button.closest('details');if(menu)menu.open=true;button.click();await settle();if(menu)assert.equal(menu.open,false);}
 function message(pattern){assert.match(w.document.getElementById('partnerNotice').textContent,pattern);assert.equal(w.document.getElementById('modal').classList.contains('hidden'),true);}
 try{
  for(const file of ['media-gallery.js','hotel-partner.js','mobile-ui.js'])vm.runInContext(fs.readFileSync(root+'/'+file,'utf8'),dom.getInternalVMContext(),{filename:file});await settle();
  w.document.getElementById('addHotelButton').click();fields({name:'شاليه اختبار معزول',city:'طرطوس',district:'مشتى الحلو',lodging_type:'chalet'});await submit();message(/تم حفظ المنشأة/);
  const h=(await query("SELECT * FROM hotels WHERE name='شاليه اختبار معزول'")).rows[0];assert.equal(h.lodging_type,'chalet');assert.equal(w.document.getElementById('hotelSelect').value,String(h.id));checks.push('Create chalet through the form');
  w.document.querySelector('#panel button').click();fields({name:'الشاليه كاملًا',room_type:'entire_unit',quantity:'1',max_guests:'4',price:'75',currency:'USD'});await submit();message(/تم حفظ الغرفة/);
  const room=(await query('SELECT * FROM hotel_rooms WHERE hotel_id=$1',[h.id])).rows[0];assert.equal(Number(room.price),75);assert.match(w.document.getElementById('stats').textContent,/1 أنواع/);checks.push('Save room, price and refresh room count');
  w.document.getElementById('workspaceMedia').click();await settle();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMZ0AAAAASUVORK5CYII=','base64');
  const mediaForm=w.document.getElementById('mediaForm');Object.defineProperty(mediaForm.elements.files,'files',{value:[new w.File([png],'qa.png',{type:'image/png'})]});mediaForm.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();
  const media=(await query('SELECT images FROM hotels WHERE id=$1',[h.id])).rows[0].images;assert.equal(media.length,1);uploaded.push(root+media[0].url);assert.equal(w.document.querySelectorAll('#mediaFiles img').length,1);checks.push('Upload and reopen saved chalet photo');w.closeModal();
  await tab('offers');w.document.querySelector('#panel button').click();fields({name:'عرض تجريبي',start_date:'2030-02-05',end_date:'2030-02-01',discount_percent:'10'});await submit();
  assert.match(form().querySelector('[role=alert]').textContent,/تواريخ العرض غير صحيحة/);assert.equal(form().elements.name.value,'عرض تجريبي');assert.equal(form().querySelector('button').disabled,false);checks.push('Invalid date returns a visible server error and preserves input');
  fields({end_date:'2030-02-10'});await submit();message(/تم حفظ العرض/);assert.equal((await query('SELECT * FROM hotel_promotions WHERE hotel_id=$1',[h.id])).rows.length,1);checks.push('Retry the same offer successfully');
  await tab('rooms');w.document.querySelector('#panel button[onclick^="openRateForm"]').click();fields({start_date:'2030-03-01',end_date:'2030-03-05',price:'95'});await submit();message(/تم حفظ السعر/);checks.push('Save seasonal rate');
  await tab('availability');w.document.querySelector('#panel button').click();fields({start_date:'2030-04-01',end_date:'2030-04-03',quantity:'1',reason:'صيانة'});await submit();message(/تم حفظ حجب/);assert.equal((await query('SELECT * FROM hotel_availability_blocks WHERE room_id=$1',[room.id])).rows.length,1);checks.push('Save availability block and open calendar');
  await tab('stay-settings');const stay=w.document.getElementById('staySettings');fields({rental_terms:'شروط اختبار فقط',free_cancel_hours:'48'},stay);await submit(stay);assert.match(w.document.getElementById('staySettingsMessage').textContent,/تم حفظ الشروط/);assert.equal((await query('SELECT free_cancel_hours FROM hotels WHERE id=$1',[h.id])).rows[0].free_cancel_hours,48);checks.push('Save rental terms');
  await tab('finance');w.document.querySelector('button[onclick^="openCommissionForm"]').click();fields({rate:'8'});await submit();message(/تم حفظ نسبة العمولة/);assert.equal(Number((await query('SELECT platform_commission_rate FROM hotels WHERE id=$1',[h.id])).rows[0].platform_commission_rate),8);checks.push('Save commission as existing full administrator');
  await tab('channels');assert.equal(w.document.querySelector('button[onclick="syncChannels()"]').disabled,true);assert.match(w.document.getElementById('panel').textContent,/لا توجد قناة مرتبطة/);checks.push('Unconnected channels are clearly marked');
  assert.equal((await query('SELECT images FROM hotels WHERE id=$1',[h.id])).rows[0].images.length,1);assert.deepEqual(errors,[]);assert.equal(calls.filter(c=>c.status>=400).length,1);
  process.stdout.write(JSON.stringify({passed:checks.length,checks,httpRequests:calls.length,expectedValidationErrors:1,unexpectedErrors:errors},null,2)+'\n');
 }finally{process.removeListener('unhandledRejection',unexpected);dom.window.close();await new Promise(r=>server.close(r));await db.close();for(const file of uploaded)fs.rmSync(file,{force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
