'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const chalet={id:8,name:'شاليه الاختبار',city:'اللاذقية',lodging_type:'chalet',images:Array.from({length:8},(_,i)=>'/uploads/chalet-'+i+'.jpg'),videos:[],room_types:0,open_bookings:0,status:'active'};
async function page(t,query=''){
 const dom=new JSDOM(read('hotel-partner.html'),{url:'https://qa.invalid/hotel-partner.html'+query,runScripts:'dangerously',pretendToBeVisual:true});
 t.after(()=>dom.window.close());const w=dom.window,scrolls=[],calls=[];
 w.HTMLElement.prototype.scrollIntoView=function(){scrolls.push(this.id);};
 w.alert=message=>{throw Error(message);};
 w.fetch=async url=>{calls.push(url);return {ok:true,json:async()=>url==='/api/auth/me'?{user:{role:'admin',name:'Owner',admin_permissions:null}}:url==='/api/office/hotels'?{data:[{id:7,name:'الفندق السابق',city:'دمشق'},structuredClone(chalet)]}:{data:[]}};};
 for(const file of ['media-gallery.js','hotel-partner.js'])vm.runInContext(read(file),dom.getInternalVMContext(),{filename:file});
 await settle();return {w,scrolls,calls};
}
test('management button brings the selected chalet into view and keeps uploaded photos available',async t=>{
 const {w,scrolls}=await page(t);
 w.document.querySelectorAll('#hotels button')[3].click();await settle();
 assert.equal(w.document.getElementById('hotelSelect').value,'8');
 assert.equal(scrolls.at(-1),'workspace');assert.equal(w.document.activeElement.id,'stats');
 assert.match(w.document.getElementById('stats').textContent,/شاليه الاختبار/);
 assert.match(w.document.getElementById('panel').textContent,/لم تُضف أي غرفة أو وحدة/);
 assert.match(w.document.getElementById('panel').textContent,/الشاليه كاملًا/);
 w.document.getElementById('workspaceMedia').click();await settle();
 assert.deepEqual([...w.document.querySelectorAll('#mediaFiles img')].map(img=>img.getAttribute('src')),chalet.images);
});
test('host portal deep link reveals the requested chalet workspace',async t=>{
 const {w,scrolls}=await page(t,'?hotel=8');
 assert.equal(w.document.getElementById('hotelSelect').value,'8');assert.equal(scrolls.at(-1),'workspace');
 assert.equal(w.document.activeElement.id,'stats');
});
test('refresh after media upload retains the selected chalet',async t=>{
 const {w}=await page(t);await w.selectHotel(8);await w.openMedia(8);
 await w.load();await w.openMedia(8);
 assert.equal(w.document.getElementById('hotelSelect').value,'8');
 assert.match(w.document.getElementById('stats').textContent,/شاليه الاختبار/);
 assert.equal(w.document.querySelectorAll('#mediaFiles img').length,8);
});
test('creating a chalet selects the newly saved establishment instead of the previous hotel',async t=>{
 const {w,scrolls}=await page(t);const fetch=w.fetch;
 w.fetch=async(url,options)=>options?.method==='POST'?{ok:true,json:async()=>({data:structuredClone(chalet)})}:fetch(url);
 w.openHotelForm();const form=w.document.querySelector('#modalBody form');
 form.elements.name.value=chalet.name;form.elements.city.value=chalet.city;form.elements.lodging_type.value='chalet';
 await w.saveHotel({preventDefault(){},target:form});
 assert.equal(w.document.getElementById('hotelSelect').value,'8');assert.equal(scrolls.at(-1),'workspace');
 assert.equal(w.document.getElementById('modal').classList.contains('hidden'),true);
});
test('failed room request displays an Arabic error and a working retry instead of a silent click',async t=>{
 const {w,scrolls}=await page(t);const fetch=w.fetch;
 w.fetch=async()=>({ok:false,status:503,json:async()=>{throw new SyntaxError('Unexpected token <');}});
 await w.selectHotel(8);
 assert.equal(scrolls.at(-1),'workspace');
 assert.match(w.document.querySelector('#panel [role=alert]').textContent,/أعد المحاولة/);
 assert.doesNotMatch(w.document.getElementById('panel').textContent,/Unexpected token/);
 w.fetch=fetch;w.document.getElementById('retryHotelWorkspace').click();await settle();
 assert.match(w.document.getElementById('panel').textContent,/لم تُضف أي غرفة أو وحدة/);
 assert.equal(w.document.getElementById('workspace').getAttribute('aria-busy'),'false');
});
test('a slow earlier hotel response cannot replace the current chalet rooms',async t=>{
 const {w}=await page(t);let resolve;
 w.fetch=()=>new Promise(done=>{resolve=done;});const earlier=w.selectHotel(7);
 w.fetch=async()=>({ok:true,json:async()=>({data:[]})});await w.selectHotel(8);
 resolve({ok:true,json:async()=>({data:[{id:1,name:'غرفة الفندق السابق'}]})});await earlier;
 assert.match(w.document.getElementById('stats').textContent,/شاليه الاختبار/);
 assert.doesNotMatch(w.document.getElementById('panel').textContent,/غرفة الفندق السابق/);
});
test('a slow tab response cannot replace the tab the user selected afterwards',async t=>{
 const {w}=await page(t);let resolve;
 w.fetch=()=>new Promise(done=>{resolve=done;});const pending=w.showTab('bookings');
 await w.showTab('rooms');resolve({ok:true,json:async()=>({data:[]})});await pending;
 assert.match(w.document.querySelector('#panel h2').textContent,/الغرف والوحدات والأسعار/);
 assert.equal(w.document.querySelector('.tabs .active').dataset.tab,'rooms');
});
test('failed offer submission keeps the form and displays a retryable inline error',async t=>{
 const {w}=await page(t);w.openOfferForm();const form=w.document.querySelector('#modalBody form');
 Object.assign(form.elements.name,{value:'عرض اختبار'});form.elements.start_date.value='2030-01-01';form.elements.end_date.value='2030-01-05';form.elements.discount_percent.value='10';
 w.fetch=async()=>({ok:false,status:503,json:async()=>({error:'تعذر حفظ العرض مؤقتًا'})});
 await w.saveOffer({preventDefault(){},target:form});
 assert.match(form.querySelector('[role=alert]').textContent,/تعذر حفظ العرض/);
 assert.equal(form.elements.name.value,'عرض اختبار');assert.equal(form.querySelector('button').disabled,false);
 assert.equal(w.document.getElementById('modal').classList.contains('hidden'),false);
});
test('double submission saves once and reports success only after the server accepts it',async t=>{
 const {w}=await page(t);w.openRateForm(19);const form=w.document.querySelector('#modalBody form');
 form.elements.start_date.value='2030-01-01';form.elements.end_date.value='2030-01-05';form.elements.price.value='50';
 let resolve,count=0;w.fetch=()=>{count++;return new Promise(done=>{resolve=done;});};
 const event={preventDefault(){},target:form},first=w.saveRate(event,19);const second=w.saveRate(event,19);
 assert.equal(count,1);assert.equal(form.querySelector('button').disabled,true);
 resolve({ok:true,json:async()=>({data:{id:1}})});await first;await second;
 assert.equal(w.document.getElementById('modal').classList.contains('hidden'),true);
 assert.match(w.document.getElementById('partnerNotice').textContent,/تم حفظ السعر/);
});
test('closing a dialog with Escape restores keyboard focus to its trigger',async t=>{
 const {w}=await page(t);const trigger=w.document.querySelector('#panel button');trigger.focus();trigger.click();
 assert.equal(w.document.getElementById('modal').classList.contains('hidden'),false);
 w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(w.document.getElementById('modal').classList.contains('hidden'),true);assert.equal(w.document.activeElement,trigger);
});
test('a completed save from a closed dialog does not close a newer dialog',async t=>{
 const {w}=await page(t);w.openRateForm(19);const form=w.document.querySelector('#modalBody form');
 form.elements.start_date.value='2030-01-01';form.elements.end_date.value='2030-01-05';form.elements.price.value='50';
 let resolve;w.fetch=()=>new Promise(done=>{resolve=done;});const saving=w.saveRate({preventDefault(){},target:form},19);
 w.closeModal();w.openOfferForm();const newForm=w.document.querySelector('#modalBody form');newForm.elements.name.value='عرض آخر';
 resolve({ok:true,json:async()=>({data:{id:1}})});await saving;
 assert.equal(w.document.getElementById('modal').classList.contains('hidden'),false);assert.equal(newForm.elements.name.value,'عرض آخر');
});
test('network failure during a non-form action is shown instead of becoming an unhandled rejection',async t=>{
 const {w}=await page(t);w.fetch=async()=>{throw new TypeError('Failed to fetch');};
 await w.toggleChannel(1,true);
 assert.match(w.document.getElementById('partnerNotice').textContent,/تعذر الاتصال/);
 assert.equal(w.document.getElementById('partnerNotice').getAttribute('role'),'alert');
});
