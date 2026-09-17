// DOM and HTTP integration audit. This emulates DOM behavior; it is not a visual browser test.
'use strict';
const {JSDOM,VirtualConsole}=require('jsdom'),{PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module'),timers=require('node:timers'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>timers.setTimeout(r,ms));
(async()=>{
 const db=new PGlite();await db.waitReady;
 const query=async(sql,args)=>{const r=args?.length?await db.query(sql,args):await db.exec(sql);return Array.isArray(r)?r.at(-1)||{rows:[]}:r;};
 const originalLoad=Module._load;let app,ready;const booted=new Promise(r=>ready=r);
 Module._load=function(id,...args){if(id==='pg')return{Pool:class{query(...a){return query(...a);}async connect(){return{query,release(){}};}}};const item=originalLoad.call(this,id,...args);if(id==='express'){function factory(){app=item();app.listen=()=>ready();return app;}Object.assign(factory,item);return factory;}return item;};
 global.setInterval=()=>({unref(){}});global.setTimeout=(fn,ms,...args)=>ms>=1000?{unref(){}}:timers.setTimeout(fn,ms,...args);
 const realFetch=global.fetch;global.fetch=(url,opts)=>String(url).startsWith('http://127.0.0.1:')?realFetch(url,opts):Promise.reject(Error('External services disabled in QA'));
 Object.assign(process.env,{ADMIN_EMAIL:'windows@qa.example.test',ADMIN_PASSWORD:'Local-Windows-QA-2026!',NODE_ENV:'test',API_RATE_LIMIT_PER_MINUTE:'99999',MAREI_LISTINGS_BATCH:'2026-09-16-marei-public-references'});
 require(root+'/server/server.js');await booted;
 const owner=(await query('SELECT id FROM users WHERE email=$1',[process.env.ADMIN_EMAIL])).rows[0].id;
 const office=(await query("INSERT INTO offices(owner_id,name,slug) VALUES($1,'QA Office','qa-windows') RETURNING id",[owner])).rows[0].id;await query('UPDATE users SET office_id=$1 WHERE id=$2',[office,owner]);
 await query("INSERT INTO office_leads(office_id,name,stage) VALUES($1,'New lead','new'),($1,'Won lead','won')",[office]);
 const property=(await query("INSERT INTO properties(owner_id,office_id,title,type,mode,city,price,area,latitude,longitude) VALUES($1,$2,'QA Property','شقة','بيع','دمشق',100000,100,33.5,36.3) RETURNING id",[owner,office])).rows[0].id;
 const host=(await query("INSERT INTO users(name,email,password_hash,is_host) VALUES('QA Host','host@qa.example.test','unused',TRUE) RETURNING id")).rows[0].id;
 const hotel=(await query("INSERT INTO hotels(owner_id,name,slug,city,status) VALUES($1,'QA Stay','qa-stay','دمشق','active') RETURNING id",[host])).rows[0].id;
 const room=(await query("INSERT INTO hotel_rooms(hotel_id,name,room_type,price,quantity,max_guests) VALUES($1,'QA Room','double',100,2,4) RETURNING id",[hotel])).rows[0].id;
 const imported=(await query('SELECT id FROM market_listings LIMIT 1')).rows[0]?.id;
 const cookies={anonymous:''};for(const [role,id] of [['admin',owner],['host',host]]){const token=require('node:crypto').randomBytes(20).toString('hex');await query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')",[id,require('node:crypto').createHash('sha256').update(token).digest('hex')]);cookies[role]='aqartkom_session='+token;}
 const server=require('node:http').createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,results=[];let current;
 const unexpected=e=>current?.errors.push(String(e.stack||e));process.on('unhandledRejection',unexpected);
 const external={
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js':require.resolve('leaflet/dist/leaflet.js'),
  'https://unpkg.com/leaflet.heat/dist/leaflet-heat.js':require.resolve('leaflet.heat/dist/leaflet-heat.js')
 };
 async function page(name,role='anonymous',suffix=''){
  const report={page:name,role,errors:[],http:[],checks:[],limitations:[]};current=report;results.push(report);
  const console=new VirtualConsole();console.on('jsdomError',e=>{if(/Not implemented: (navigation|HTMLCanvasElement|window.scroll)/.test(e.message))report.limitations.push(e.message);else report.errors.push(e.stack||e.message);});
  const dom=new JSDOM(fs.readFileSync(path.join(root,name),'utf8'),{url:base+'/'+name+suffix,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});const w=dom.window;await pause(0);
  let pending=0,loading=true;Object.defineProperty(w.document,'readyState',{get:()=>loading?'loading':'complete'});
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};w.alert=message=>report.checks.push('alert: '+message);w.confirm=()=>false;w.prompt=()=>null;w.open=()=>null;
  w.SVGSVGElement.prototype.createSVGRect=()=>({});Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{get(){return 800;}});Object.defineProperty(w.HTMLElement.prototype,'clientHeight',{get(){return 500;}});
  w.setInterval=()=>0;const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>ms>=1000?0:timeout(fn,ms,...args);w.crypto.randomUUID=require('node:crypto').randomUUID;
  w.fetch=async(url,opts={})=>{const u=new URL(url,w.location.href);if(u.origin!==base)throw Error('External page request disabled: '+u.origin);pending++;try{const response=await realFetch(u,{...opts,headers:{...(cookies[role]?{cookie:cookies[role]}:{}),...opts.headers}});report.http.push({path:u.pathname,status:response.status});return response;}finally{pending--;}};
  w.localStorage.setItem('aqartkom_compare',JSON.stringify([property]));
  const scripts=[...w.document.querySelectorAll('script')];const ordered=[...scripts.filter(s=>!s.defer),...scripts.filter(s=>s.defer)];
  for(const s of ordered){let code=s.textContent,file=name;if(s.src){const u=new URL(s.src);if(u.origin===base)file=path.join(root,u.pathname);else if(external[s.src])file=external[s.src];else{report.limitations.push('External widget not executed: '+s.src);continue;}code=fs.readFileSync(file,'utf8');}if(code.trim())try{vm.runInContext(code,dom.getInternalVMContext(),{filename:file});}catch(e){report.errors.push(e.stack||e.message);}}
  loading=false;w.document.dispatchEvent(new w.Event('DOMContentLoaded'));w.dispatchEvent(new w.Event('load'));
  async function settle(){for(let i=0;i<100;i++){await pause(20);if(!pending){await pause(20);if(!pending)return;}}report.errors.push('Requests did not settle');}
  function checkHandlers(){for(const element of w.document.querySelectorAll('[onclick],[onchange],[onsubmit]'))for(const attr of ['onclick','onchange','onsubmit']){const handler=element.getAttribute(attr)||'',name=handler.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/)?.[1];if(name&&vm.runInContext('typeof '+name,dom.getInternalVMContext())!=='function'){const error='Undefined handler: '+name;if(!report.errors.includes(error))report.errors.push(error);}}}
  async function run(label,work){current=report;try{await work(w);await settle();checkHandlers();report.checks.push(label);}catch(e){report.errors.push(label+': '+(e.stack||e.message));}}
  await settle();checkHandlers();return {w,dom,report,run,settle};
 }
 try{
  for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.html')).sort()){
   const suffix=name==='property.html'?'?id='+property:name==='office-public.html'?'?slug=qa-windows':name==='office-property.html'?'?id='+imported:'';
   const p=await page(name,'anonymous',suffix);assert.ok(p.w.document.body.textContent.trim(),name+' has no body');p.report.checks.push('page loaded');p.dom.window.close();
  }
  for(const name of ['admin.html','offer-review.html','admin-team.html','hotel-demo.html','shamcash-admin.html','office.html','office-growth.html','market-monitor.html','regional-agents.html','messages.html','request-dashboard.html','office-request-inbox.html','office-videos.html']){
   const p=await page(name,'admin');
   const tabs=[...p.w.document.querySelectorAll('[data-tab]')].map(b=>b.dataset.tab);
   for(const tab of tabs)await p.run('tab '+tab,w=>w.document.querySelector('[data-tab="'+tab+'"]').click());
   if(name==='office.html'){
    await p.run('reports do not repeatedly fetch',async w=>{w.document.querySelector('[data-tab=reports]').click();await p.settle();assert.equal(p.report.http.filter(r=>r.path==='/api/office/report').length,1);});
    await p.run('report failure can be retried',async w=>{const fetch=w.fetch;w.fetch=async(url,...args)=>String(url).includes('/office/report')?new Response(JSON.stringify({error:'QA temporary failure'}),{status:503,headers:{'Content-Type':'application/json'}}):fetch(url,...args);await vm.runInContext('loadReports()',p.dom.getInternalVMContext());assert.match(w.document.querySelector('[role=alert]').textContent,/QA temporary failure/);w.fetch=fetch;w.document.querySelector('[role=alert] button').click();await p.settle();assert.equal(w.document.querySelector('[role=alert]'),null);});
    await p.run('property search filters rows',w=>{w.document.querySelector('[data-tab=properties]').click();const field=w.document.getElementById('propSearch');field.value='does-not-exist';field.dispatchEvent(new w.Event('input'));assert.ok([...w.document.querySelectorAll('#propRows tr')].every(r=>r.hidden));field.value='QA Property';field.dispatchEvent(new w.Event('input'));assert.equal(w.document.querySelector('#propRows tr').hidden,false);});
    await p.run('lead stage filters rows',w=>{w.document.querySelector('[data-tab=leads]').click();const field=w.document.getElementById('leadFilter');field.value='won';field.dispatchEvent(new w.Event('change'));const visible=[...w.document.querySelectorAll('#page tbody tr')].filter(r=>!r.hidden);assert.equal(visible.length,1);assert.match(visible[0].textContent,/Won lead/);});
    for(const expression of ['newLead()','newAppointment()','newDeal()','newStaff()'])await p.run('office modal '+expression,w=>{vm.runInContext(expression,p.dom.getInternalVMContext());const m=w.document.querySelector('.modal.open');assert.ok(m.querySelector('form'));m.remove();});
   }
   p.dom.window.close();
  }
  for(const role of ['anonymous','admin']){
   const p=await page('index.html',role);
   const cases=role==='anonymous'?[['login','openAuth()','authModal']]:[['account','openUserAccount()','accountModal'],['dashboard','openAccount()','dashboardModal'],['saved searches','openSavedSearches()','savedSearchesModal'],['notifications','openNotifications()','notificationsModal'],['add property','openProperty()','propertyModal']];
   for(const [label,expression,id] of cases)await p.run(label+' modal opens and closes',async w=>{await vm.runInContext(expression,p.dom.getInternalVMContext());await p.settle();const m=w.document.getElementById(id);assert.ok(m?.classList.contains('open'));if(id==='authModal'){m.querySelector('[data-auth=register]').click();assert.ok(m.querySelector('[name=name]'));m.querySelector('[data-auth=login]').click();assert.equal(m.querySelector('[name=name]'),null);}if(id==='dashboardModal'){for(const b of m.querySelectorAll('[data-dtab]'))b.click();m.querySelector('[data-dtab=properties]').click();m.querySelector('[data-edit]').click();assert.ok(w.document.getElementById('editPropertyModal')?.classList.contains('open'));w.document.querySelector('#editPropertyModal .modalclose').click();m.querySelector('[data-images]').click();assert.ok(w.document.getElementById('mediaModal')?.classList.contains('open'));w.document.querySelector('#mediaModal .modalclose').click();}m.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.ok(!m.isConnected||!m.classList.contains('open'));});
   p.dom.window.close();
  }
  const hostPage=await page('host-portal.html','host');assert.equal(hostPage.w.document.getElementById('dashboard').hidden,false);assert.match(hostPage.w.document.getElementById('list').textContent,/QA Stay/);hostPage.report.checks.push('own-property dashboard');hostPage.dom.window.close();
  const partner=await page('hotel-partner.html','host','?hotel='+hotel);
  for(const b of [...partner.w.document.querySelectorAll('[data-tab]')].filter(b=>!b.hidden))await partner.run('host tab '+b.dataset.tab,()=>b.click());
  for(const [label,expression] of [['new property','openHotelForm()'],['new room','openRoomForm()'],['seasonal rate','openRateForm('+room+')'],['availability','openBlockForm()'],['offer','openOfferForm()'],['property media','openMedia('+hotel+')'],['room media','openMedia('+hotel+','+room+')']])await partner.run(label,async w=>{await vm.runInContext(expression,partner.dom.getInternalVMContext());assert.equal(w.document.getElementById('modal').classList.contains('hidden'),false);assert.ok(w.document.getElementById('modalBody').textContent.trim());vm.runInContext('closeModal()',partner.dom.getInternalVMContext());assert.equal(w.document.getElementById('modal').classList.contains('hidden'),true);});partner.dom.window.close();
  const adminPartner=await page('hotel-partner.html','admin','?hotel='+hotel);for(const b of adminPartner.w.document.querySelectorAll('[data-tab]'))await adminPartner.run('admin hotel tab '+b.dataset.tab,()=>b.click());await adminPartner.run('commission modal',w=>{vm.runInContext('openCommissionForm(10)',adminPartner.dom.getInternalVMContext());assert.equal(w.document.querySelector('[name=rate]').value,'10');vm.runInContext('closeModal()',adminPartner.dom.getInternalVMContext());});adminPartner.dom.window.close();
  const hotelsPage=await page('hotels.html');await hotelsPage.run('hotel details and reviews',()=>vm.runInContext('openHotel('+hotel+')',hotelsPage.dom.getInternalVMContext()));await hotelsPage.run('booking quote and payment choices',()=>vm.runInContext('bookingForm('+hotel+','+room+')',hotelsPage.dom.getInternalVMContext()));assert.ok(hotelsPage.w.document.getElementById('bookingForm'));assert.ok(hotelsPage.w.document.querySelector('[name=accept_stay_terms]').required);hotelsPage.dom.window.close();
  const reportPath=process.env.WINDOWS_QA_OUTPUT||path.join(root,'qa/windows-results.json');fs.writeFileSync(reportPath,JSON.stringify(results,null,2));
  const errors=results.flatMap(r=>r.errors.map(error=>({page:r.page,role:r.role,error}))),serverErrors=results.flatMap(r=>r.http.filter(x=>x.status>=500||(r.role!=='anonymous'&&x.status>=400)).map(x=>({page:r.page,...x})));
  console.log(JSON.stringify({pageScenarios:results.length,checks:results.reduce((n,r)=>n+r.checks.length,0),errors,serverErrors},null,2));process.exitCode=errors.length||serverErrors.length?1:0;
 }finally{process.removeListener('unhandledRejection',unexpected);await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
