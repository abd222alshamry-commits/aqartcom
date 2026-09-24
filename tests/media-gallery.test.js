'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { items } = require('../media-gallery');
const root = path.join(__dirname, '..');
const hotel = {id:7,name:'Aqartcom',city:'دمشق',images:['/assets/property-interior.webp',{url:'/uploads/hotel.jpg'}],videos:JSON.stringify(['/uploads/lobby.mp4?token=abc'])};
const room = {id:19,name:'201',room_type:'double',max_guests:2,price:80,currency:'USD',images:[{url:'/uploads/room.jpg'}],videos:[{url:'https://media.example/room.MOV?token=xyz',poster_url:'/uploads/poster.jpg'}]};
function run(dom, file) {return vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),dom.getInternalVMContext(),{filename:file});}
function harness(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(root,'hotels.html'),'utf8'),{url:'https://aqartcom-v93.onrender.com/hotels.html',runScripts:'dangerously',pretendToBeVisual:true});
  t.after(()=>dom.window.close()); const w = dom.window, calls = [], videos = [];
  w.PropertyVideo = {open:video=>videos.push(video)};
  w.fetch = async url => {
    calls.push(String(url));
    if(String(url).includes('review-bookings'))return {ok:false,status:401,json:async()=>({})};
    if(String(url).endsWith('/reviews'))return {ok:true,json:async()=>({data:[]})};
    if(String(url).startsWith('/api/hotels?'))return {ok:true,json:async()=>({data:[hotel]})};
    return {ok:true,json:async()=>({hotel,rooms:[room]})};
  };
  for(const file of ['media-gallery.js','hotel-details.js','hotels.js'])run(dom,file);
  return {dom,w,calls,videos};
}
const settle = async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};
test('saved arrays, JSON arrays, object URLs and signed video links are preserved safely',()=>{
  const rows=items({images:JSON.stringify(['/assets/one.webp',{url:'https://images.example/two.jpg?token=x'},null,{url:'javascript:alert(1)'}]),videos:['/uploads/clip.mp4?signature=abc',{url:'https://media.example/clip.mov#t=2'},{url:'https://name:password@evil.example/file.mp4'}]});
  assert.equal(rows.length,4); assert.equal(rows[2].url,'/uploads/clip.mp4?signature=abc');
  assert.equal(items({images:'/uploads/old.jpg'})[0].url,'/uploads/old.jpg');
  assert.equal(items({images:[null,{},'data:text/html,evil','file:///tmp/private']}).length,0);
});
test('hotel details collect hotel and room media and images open without losing the hotel',async t=>{
  const {w}=harness(t); await w.openHotel(7);
  const host=w.document.getElementById('hotelMedia');assert.equal(host.querySelectorAll('.media-gallery-item').length,5);
  host.querySelector('[data-filter=image]').click();assert.equal(host.querySelectorAll('.media-gallery-item').length,3);
  const launch=host.querySelector('.media-gallery-item');launch.focus();launch.click();
  const viewer=w.document.querySelector('.media-image-viewer');assert.ok(viewer);assert.equal(viewer.querySelector('.media-image-tools span').textContent,'1 / 3');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(viewer.querySelector('.media-image-tools span').textContent,'2 / 3');
  viewer.querySelector('.media-image-stage img').dispatchEvent(new w.Event('error'));assert.equal(viewer.querySelector('.media-image-retry').hidden,false);
  viewer.querySelector('.media-image-retry').click();assert.equal(viewer.querySelector('.media-image-retry').hidden,true);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(w.document.querySelector('.media-image-viewer'),null);assert.equal(w.document.getElementById('modal').classList.contains('hidden'),false);
  assert.equal(w.document.activeElement,launch);
});
test('video filter opens the saved room video through the existing player',async t=>{
  const {w,videos}=harness(t);await w.openHotel(7);const host=w.document.getElementById('hotelMedia');
  host.querySelector('[data-filter=video]').click();const buttons=host.querySelectorAll('.media-gallery-item');assert.equal(buttons.length,2);buttons[1].click();
  assert.equal(videos[0].url,room.videos[0].url);assert.equal(videos[0].title,'الغرفة: 201');
  assert.equal(videos[0].poster_url,'/uploads/poster.jpg');
});
test('empty videos stay explicit, the hotel photo/name open details, and failures can be retried',async t=>{
  const {w,calls}=harness(t);await settle();w.document.querySelector('.hotel-open-photo').click();await settle();assert.ok(calls.includes('/api/hotels/7'));
  w.closeHotelDetails();w.document.querySelector('.hotel-name').click();await settle();assert.equal(w.document.getElementById('modal').classList.contains('hidden'),false);
  const fetch=w.fetch;w.fetch=async()=>{throw Error('اتصال منقطع');};await w.openHotel(7);assert.match(w.document.querySelector('[role=alert]').textContent,/اتصال منقطع/);
  w.fetch=async()=>({ok:true,json:async()=>({hotel:{...hotel,videos:[]},rooms:[]})});w.document.getElementById('retryHotel').click();await settle();
  const host=w.document.getElementById('hotelMedia');host.querySelector('[data-filter=video]').click();assert.match(host.textContent,/لا توجد فيديوهات مسجلة/);w.fetch=fetch;
});
test('closing while loading ignores the late response',async t=>{
  const {w}=harness(t);await settle();let resolve;w.fetch=()=>new Promise(r=>{resolve=r;});const pending=w.openHotel(7);w.closeHotelDetails();
  resolve({ok:true,json:async()=>({hotel,rooms:[room]})});await pending;
  assert.equal(w.document.getElementById('modal').classList.contains('hidden'),true);assert.equal(w.document.getElementById('hotelMedia'),null);
});
test('property gallery exposes every saved image instead of truncating to five',async t=>{
  const dom=new JSDOM('<main id="app"></main><div id="toast"></div>',{url:'https://aqartcom-v93.onrender.com/property.html?id=1',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
  w.PropertyVideo={preview:()=>''};w.advertiserContactLinks=()=>null;w.installAdvertiserContact=()=>{};
  const property={id:1,title:'عقار تجريبي',is_demo:true,images:Array.from({length:12},(_,i)=>({url:'/uploads/photo-'+i+'.jpg'})),videos:[]};
  w.fetch=async()=>({ok:true,json:async()=>({data:property})});run(dom,'media-gallery.js');run(dom,'property.js');await settle();
  assert.equal(w.document.querySelectorAll('#propertyMedia .media-gallery-item').length,12);
});
test('host media manager keeps saved asset and absolute URLs visible',async t=>{
  const dom=new JSDOM('<div id="modalBody"></div>',{url:'https://aqartcom-v93.onrender.com/hotel-partner.html',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
  w.alert=message=>{throw Error(message);};w.hotels=[{...hotel,images:JSON.stringify(hotel.images),videos:[]}];w.openModal=html=>w.document.getElementById('modalBody').innerHTML=html;
  run(dom,'media-gallery.js');const lines=fs.readFileSync(path.join(root,'hotel-partner.js'),'utf8').split('\n'),source=lines.find(line=>line.startsWith('async function openMedia('));vm.runInContext('const $=id=>document.getElementById(id);'+lines[1]+'\n'+source,dom.getInternalVMContext());await w.openMedia(7);
  assert.equal(w.document.querySelectorAll('#mediaFiles img').length,2);w.document.querySelector('.partner-media-preview').click();assert.ok(w.document.querySelector('.media-image-viewer'));
});
test('office property details expose all recorded image URLs',async t=>{
  const dom=new JSDOM(fs.readFileSync(path.join(root,'office-property.html'),'utf8'),{url:'https://aqartcom-v93.onrender.com/office-property.html?id=18',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
  w.fetch=async()=>({ok:true,json:async()=>({data:{id:18,title:'صور مكتب',media:[{type:'image',url:'https://images.example/a.jpg'},{url:'/assets/fb-house.jpg'},{type:'video',url:'https://media.example/v.mp4'}]}})});
  run(dom,'media-gallery.js');run(dom,'office-card.js');run(dom,'office-property.js');await settle();
  assert.equal(w.document.querySelectorAll('#officePropertyMedia .media-gallery-item').length,2);
});
