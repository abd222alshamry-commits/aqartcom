'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'regional-agents.html'),'utf8');
const script=fs.readFileSync(path.join(root,'regional-agents.js'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
function fixture(overrides={}){
  return {model:'gpt-5.6-sol',timezone:'Asia/Damascus',times:['18:00','23:00'],configured:false,verified:false,
    settings:{enabled:false,calls_per_cycle:42,calls_per_day:84,auto_publish:true,pause_reason:null,verified_at:null},
    catalog:{governorates:14,localities:7605,targets:7619,coverageNote:'الأحياء غير مكتملة.',byGovernorate:[{id:'SY01',name:'دمشق',localities:2,targets:3}]},
    platforms:['facebook','instagram','tiktok'],total_tasks:22857,next_run:'2026-09-17T15:00:00Z',calls_today:0,stats:[],coverage:[],jobs:[],runs:[],...overrides};
}
async function page({admin=true,status=fixture(),targetResponse={data:[],page:1,total:0}}={}){
  const elements=new Map(ids.map(id=>[id,{id,hidden:['manager','signIn','setupNote','pauseReason','actionError'].includes(id),disabled:false,value:'',checked:false,textContent:'',innerHTML:'',options:id==='targetGovernorate'?[{text:'كل المحافظات',value:''}]:[],add(option){this.options.push(option);}}]));
  const calls=[];
  async function fetch(url,options={}){
    calls.push({url,options});
    let body;
    if(url==='/api/auth/me')body={user:admin?{role:'admin'}:null};
    else if(url==='/api/admin/regional-agents')body=status;
    else if(url.startsWith('/api/admin/regional-agents/targets?'))body=targetResponse;
    else if(url==='/api/admin/regional-agents/verify'){status.verified=true;status.settings.verified_at='2026-09-17T12:00:00Z';body={ok:true};}
    else if(url==='/api/admin/regional-agents/settings'){Object.assign(status.settings,JSON.parse(options.body));body={ok:true};}
    else if(url==='/api/admin/regional-agents/run')body={ok:true,run_id:1};
    else throw Error('Unexpected request '+url);
    return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(body))};
  }
  const context={document:{getElementById:id=>{assert.ok(elements.has(id),'missing #'+id);return elements.get(id);},hidden:false},window:{addEventListener(){}},fetch,URLSearchParams,Option:function(text,value){this.text=text;this.value=value;},setInterval:()=>1,clearInterval(){}};
  await vm.runInNewContext(script,context);
  return {elements,calls,status,get:id=>elements.get(id)};
}
const event={preventDefault(){}};

test('regional admin HTML has unique DOM ids, matching script targets, no secret inputs and mobile layout rules',()=>{
  assert.equal(ids.length,new Set(ids).size);
  for(const [,id] of script.matchAll(/\bel\('([^']+)'\)/g))assert.ok(ids.includes(id),id);
  assert.match(html,/<html lang="ar" dir="rtl">/);assert.match(html,/width=device-width,initial-scale=1/);
  assert.match(html,/<section id="manager" hidden>/);assert.ok(!/type="password"/.test(html));
  assert.match(html,/النتائج العامة المفهرسة/);assert.match(html,/لا تُبحث جميع المناطق في كل جولة/);
  const css=fs.readFileSync(path.join(root,'regional-agents.css'),'utf8');assert.match(css,/@media\(max-width:620px\)/);assert.match(css,/minmax\(0,1fr\)/);assert.match(css,/\[hidden\]\{display:none!important\}/);
  assert.match(fs.readFileSync(path.join(root,'admin.html'),'utf8'),/href="\/regional-agents.html"/);
  assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'),/office-card\.js\?v=[a-zA-Z0-9-]+/);
});

test('signed-out visitors never load or reveal the regional dashboard',async()=>{
  const p=await page({admin:false});
  assert.equal(p.get('manager').hidden,true);assert.equal(p.get('signIn').hidden,false);
  assert.deepEqual(p.calls.map(call=>call.url),['/api/auth/me']);
  assert.equal(p.get('governorateCount').textContent,'');
});

test('connection verification gates enablement, and active schedule gates manual runs',async()=>{
  const p=await page();
  assert.equal(p.get('manager').hidden,false);assert.equal(p.get('pageStatus').hidden,true);
  assert.equal(p.get('setupNote').hidden,false);assert.equal(p.get('verifyConnection').disabled,true);
  assert.equal(p.get('toggleSchedule').disabled,true);assert.equal(p.get('runNow').disabled,true);
  assert.equal(p.get('callsPerCycle').value,42);assert.equal(p.get('callsPerDay').value,84);assert.equal(p.get('autoPublish').checked,true);
  const connected=await page({status:fixture({configured:true})});
  assert.equal(connected.get('verifyConnection').disabled,false);assert.equal(connected.get('toggleSchedule').disabled,true);
  await connected.get('verifyConnection').onclick();
  assert.equal(connected.get('toggleSchedule').disabled,false);assert.equal(connected.get('runNow').disabled,true);
  await connected.get('toggleSchedule').onclick();
  assert.equal(connected.status.settings.enabled,true);assert.equal(connected.get('runNow').disabled,false);
  await connected.get('runNow').onclick();
  assert.match(connected.get('actionStatus').textContent,/قائمة التنفيذ/);
  const changes=connected.calls.filter(c=>c.options.method==='PATCH').map(c=>JSON.parse(c.options.body));assert.deepEqual(changes,[{enabled:true}]);
});

test('queue and daily limits disable duplicate manual starts, while settings validate and persist',async()=>{
  const s=fixture({configured:true,verified:true});s.settings.enabled=true;s.stats=[{state:'pending',count:3,published:0,review:0}];
  const p=await page({status:s});assert.equal(p.get('runNow').disabled,true);assert.match(p.get('runHint').textContent,/مهمة/);
  p.get('callsPerCycle').value='50';p.get('callsPerDay').value='49';
  await p.get('settingsForm').onsubmit(event);assert.equal(p.get('actionError').hidden,false);assert.equal(p.calls.filter(c=>c.options.method==='PATCH').length,0);
  p.get('callsPerDay').value='100';p.get('autoPublish').checked=false;
  await p.get('settingsForm').onsubmit(event);assert.equal(s.settings.calls_per_cycle,50);assert.equal(s.settings.calls_per_day,100);assert.equal(s.settings.auto_publish,false);
  s.stats=[];s.calls_today=100;await p.get('refreshStatus').onclick();assert.equal(p.get('runNow').disabled,true);assert.match(p.get('runHint').textContent,/حد البحث اليومي/);
});

test('coverage, job errors, skipped rounds and filtered target results remain escaped and truthful',async()=>{
  const s=fixture({configured:true,verified:true});
  s.coverage=[{governorate_id:'SY01',searched:2,last_searched:'2026-09-17T12:00:00Z'}];
  s.jobs=[{id:1,target_name:'<img src=x onerror=alert(1)>',platform:'tiktok',state:'error',published_count:0,review_count:0,duplicate_count:0,error_message:'<script>secret()</script>'}];
  s.runs=[{slot:'2026-09-17T18:00',scheduled_at:'2026-09-17T15:00:00Z',finished_at:'2026-09-17T15:00:01Z',planned_count:0,pending:0,skipped_reason:'الجولة السابقة لم تنتهِ <script>'}];
  const p=await page({status:s,targetResponse:{data:[{name:'المزة <script>',governorateName:'دمشق',kind:'town'}],page:1,total:31}});
  assert.match(p.get('coverageGrid').innerHTML,/max="9" value="2"/);
  assert.ok(!p.get('jobHistory').innerHTML.includes('<img'));assert.ok(p.get('jobHistory').innerHTML.includes('&lt;img'));
  assert.ok(!p.get('jobHistory').innerHTML.includes('<script>'));assert.ok(p.get('runHistory').innerHTML.includes('لم تبدأ جولة جديدة'));assert.ok(!p.get('runHistory').innerHTML.includes('<script>'));
  assert.ok(!p.get('targetList').innerHTML.includes('<script>'));assert.equal(p.get('nextTargets').disabled,false);
  p.get('targetQuery').value='مشتى الحلو';p.get('targetGovernorate').value='SY10';await p.get('targetSearch').onsubmit(event);
  const request=p.calls.at(-1),query=new URL('http://local'+request.url).searchParams;
  assert.equal(query.get('q'),'مشتى الحلو');assert.equal(query.get('governorate'),'SY10');assert.equal(query.get('page'),'1');
});
