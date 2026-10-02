'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),tick=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const quote={hotel_id:1,room_id:2,hotel_name:'Test chalet',room_name:'Unit',total:80,subtotal:80,currency:'USD',check_in:'2099-06-01',check_out:'2099-06-03',nights:2,rooms_count:1,adults:2,children:0,terms_version:1,stay_terms:{},cancellation_deadline:'2099-05-31T11:00:00Z',nightly:[{date:'2099-06-01',rooms_count:1,total:40},{date:'2099-06-02',rooms_count:1,total:40}]};
const receipt={...quote,booking_code:'AQH-123456789012345678',status:'confirmed',payment_method:'pay_at_hotel',payment_status:'unpaid',price_breakdown:quote.nightly};
function setup(t,{ua='AqartkomNative/170',url='https://example.test/hotels.html',saved={},book,bookings=[],onLookup=()=>{}}={}){
 const browser=new JSDOM(fs.readFileSync(path.join(root,'hotels.html'),'utf8'),{url,runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>browser.window.close());const w=browser.window;
 Object.defineProperty(w.navigator,'userAgent',{value:ua});w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const [k,v] of Object.entries(saved))w.localStorage.setItem(k,v);
 w.fetch=async(url,options={})=>{
  let data;if(url.startsWith('/api/stays/search'))data={data:[]};
  else if(url.startsWith('/api/mobile/hotels/quote'))data={data:quote};
  else if(url==='/api/mobile/hotels/book')return book(JSON.parse(options.body));
  else if(url==='/api/stays/bookings')data={signed_in:false,data:bookings};
  else if(url.startsWith('/api/stays/booking/')){onLookup(url);data={data:receipt};}
  else if(url.startsWith('/api/stays/1/availability'))data={hotel:{id:1,name:quote.hotel_name,images:[],amenities:[]},data:[]};
  else if(url.endsWith('/reviews')||url.endsWith('/review-bookings'))data={data:[]};
  else throw Error('Unexpected request: '+url);
  return {ok:true,json:async()=>data};
 };
 for(const file of ['listing-cover.js','media-gallery.js','hotel-details.js','stay-checkout.js','hotels.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),browser.getInternalVMContext());
 return {w,run:s=>vm.runInContext(s,browser.getInternalVMContext())};
}
async function review(w){
 await w.bookingForm(1,2);const form=w.document.getElementById('bookingForm');form.elements.guest_name.value='Test guest';form.elements.guest_phone.value='00000000';form.elements.guest_email.value='guest@example.test';form.querySelector('[type=submit]').click();
}
function confirm(w){w.document.querySelector('[name=accept_stay_terms]').checked=true;w.document.getElementById('confirmBooking').click();}
test('Android recovers the same request after WebView/process restart and retains the receipt',async t=>{
 let firstBody;const a=setup(t,{book:async body=>{firstBody=body;throw new TypeError('Response lost after commit');}});
 await review(a.w);confirm(a.w);await tick();assert.ok(a.w.document.getElementById('retryBooking'));
 const key='aq-stay-pending',saved=a.w.localStorage.getItem(key);assert.ok(saved);assert.equal(a.w.sessionStorage.getItem(key),null);
 const b=setup(t,{saved:{[key]:saved},book:async body=>{assert.deepEqual(body,firstBody);return {ok:true,json:async()=>({data:receipt})};}});
 await b.w.bookingForm(1,2);assert.ok(b.w.document.getElementById('retryBooking'));b.w.document.getElementById('retryBooking').click();await tick();
 assert.equal(b.w.localStorage.getItem(key),null);assert.match(b.w.document.querySelector('.receipt-header').textContent,/حجزك مؤكد/);assert.equal(b.w.document.getElementById('downloadBooking').getAttribute('href'),'/api/stays/booking/'+receipt.booking_code+'/document');
 const c=setup(t,{saved:{'aq-stay-receipts':b.w.localStorage.getItem('aq-stay-receipts')}});await c.w.showMyBookings();
 assert.match(c.w.document.getElementById('bookingList').textContent,/AQH-123456789012345678/);assert.match(c.w.document.getElementById('bookingsNote').textContent,/هذا الجهاز/);
});
test('storage failure prevents submission; old clients keep session storage',async t=>{
 let posts=0;const {w,run}=setup(t,{book:async()=>{posts++;throw Error('Must not send');}});await review(w);
 Object.defineProperty(w,'localStorage',{get(){throw new Error('Storage unavailable');}});confirm(w);await tick();assert.equal(posts,0);assert.match(w.document.getElementById('bookingError').textContent,/لم يُرسل الطلب/);assert.equal(run("stayRead('pending',null)"),null);
 const old=setup(t,{ua:'AqartkomNative/160'});assert.equal(old.run("stayWrite('receipts',[{booking_code:'OLD'}])"),true);assert.ok(old.w.sessionStorage.getItem('aq-stay-receipts'));assert.equal(old.w.localStorage.getItem('aq-stay-receipts'),null);
});
test('Android back returns to guest details and closes cancellation without cancelling',async t=>{
 const {w}=setup(t);await review(w);assert.ok(w.document.getElementById('confirmBookingForm'));
 assert.equal(w.aqartkomNativeBack(),true);assert.equal(w.document.getElementById('bookingForm').elements.guest_name.value,'Test guest');
 await w.loadBookingReceipt(receipt.booking_code);w.document.getElementById('cancelBooking').click();assert.ok(w.document.getElementById('cancelForm'));
 assert.equal(w.aqartkomNativeBack(),true);assert.equal(w.document.getElementById('cancelForm'),null);assert.ok(w.document.querySelector('.receipt-header'));
 const media=w.document.createElement('div');media.className='media-image-viewer';w.document.body.append(media);assert.equal(w.aqartkomNativeBack(),false);media.remove();
 assert.equal(w.aqartkomNativeBack(),true);assert.ok(w.document.getElementById('modal').classList.contains('hidden'));assert.equal(w.aqartkomNativeBack(),false);
});
test('legacy receipt fragment opens updated details without putting the code in query parameters',async t=>{
 const lookups=[];const {w}=setup(t,{url:'https://example.test/hotels.html#booking='+receipt.booking_code,onLookup:url=>lookups.push(url)});await tick();
 assert.deepEqual(lookups,['/api/stays/booking/'+receipt.booking_code]);assert.match(w.document.querySelector('.receipt-header').textContent,/AQH-123456789012345678/);assert.ok(!w.location.search.includes('AQH-'));
 const hashChanged=new Promise(resolve=>w.addEventListener('hashchange',resolve,{once:true}));w.location.hash='#bookings';await hashChanged;await tick();assert.ok(w.document.getElementById('lookupBooking'));
});
