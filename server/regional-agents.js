'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const catalog=require('./regional-catalog');
const {MODEL,searchRegion,verifyKey}=require('./regional-search');
const TIMEZONE='Asia/Damascus';
const LOCK_ID=73916281;
const TOTAL_TASKS=catalog.targets.length*catalog.PLATFORMS.length;
const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function localParts(date){return Object.fromEntries(dateFormatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
function localDay(date){const p=localParts(date);return `${p.year}-${p.month}-${p.day}`;}
// Convert a local wall time with Intl, not the server's timezone or a fixed UTC offset.
function wallTime(day,hour){
  const desired=Date.parse(day+'T'+String(hour).padStart(2,'0')+':00:00Z');
  let actual=desired;
  for(let i=0;i<3;i++){const p=localParts(new Date(actual));const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);actual+=desired-represented;}
  return new Date(actual);
}
function schedule(now=new Date()){
  const day=localDay(now),yesterday=localDay(new Date(now.getTime()-86400000)),tomorrow=localDay(new Date(now.getTime()+86400000));
  const times=[yesterday,day,tomorrow].flatMap(d=>[18,23].map(h=>({key:d+'T'+h+':00',at:wallTime(d,h)})));
  return {due:times.filter(x=>x.at<=now).at(-1),next:times.find(x=>x.at>now)};
}
function taskAt(cursor){const target=catalog.targets[Math.floor(cursor/3)%catalog.targets.length];return {target,platform:catalog.PLATFORMS[cursor%3]};}
const keyHash=key=>key?crypto.createHash('sha256').update(key).digest('hex'):null;

async function saveListings(db,listings,autoPublish){
  const counts={published:0,review:0,duplicates:0};
  for(const item of listings){
    const status=autoPublish&&item.publishable?'published':'pending';
    // Never revive a rejected/sold post, overwrite editorial content, or discard hosted media.
    const result=await db.query(`INSERT INTO market_listings(platform,external_id,external_url,advertiser_name,title,description,
      phone,city,district,property_type,listing_mode,price,currency,area,media,status,raw_data)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'[]'::jsonb,$15,$16)
      ON CONFLICT(platform,external_id) DO NOTHING RETURNING id`,[item.platform,item.external_id,item.external_url,
      item.advertiser_name,item.title,item.description,item.phone,item.city,item.district,item.property_type,item.listing_mode,
      item.price,item.currency,item.area,status,JSON.stringify(item.raw_data)]);
    if(!result.rows.length){counts.duplicates++;continue;}
    if(status==='published')counts.published++;else counts.review++;
  }
  return counts;
}
async function enqueue(db,slot,settings){
  const run=(await db.query(`INSERT INTO regional_agent_runs(slot,scheduled_at) VALUES($1,$2) ON CONFLICT(slot) DO NOTHING RETURNING id`,[slot.key,slot.at])).rows[0];
  if(!run)return null;
  if((await db.query("SELECT id FROM regional_agent_jobs WHERE state IN ('pending','running') LIMIT 1")).rows.length){
    await db.query("UPDATE regional_agent_runs SET finished_at=NOW(),skipped_reason='استكمال الجولة السابقة قبل بدء مناطق إضافية.' WHERE id=$1",[run.id]);
    return run.id;
  }
  let cursor=settings.next_cursor;
  for(let i=0;i<settings.calls_per_cycle;i++){
    const {target,platform}=taskAt(cursor);
    await db.query(`INSERT INTO regional_agent_jobs(run_id,target_id,governorate_id,platform) VALUES($1,$2,$3,$4)`,[run.id,target.id,target.governorateId,platform]);
    cursor=(cursor+1)%TOTAL_TASKS;
  }
  await db.query('UPDATE regional_agent_runs SET planned_count=$1 WHERE id=$2',[settings.calls_per_cycle,run.id]);
  await db.query('UPDATE regional_agent_settings SET next_cursor=$1 WHERE id=1',[cursor]);
  return run.id;
}

async function register(app,{pool,requireAdmin,env=process.env,fetcher=fetch,startTimer=true}){
  await pool.query(fs.readFileSync(path.join(__dirname,'regional-agents-schema.sql'),'utf8'));
  let working=false,stopped=false;
  const key=()=>env.REGIONAL_OPENAI_API_KEY||env.OPENAI_API_KEY||'';
  async function settings(db=pool){return (await db.query('SELECT * FROM regional_agent_settings WHERE id=1')).rows[0];}
  async function dayCount(db=pool,now=new Date()){return (await db.query(`SELECT COUNT(*)::int AS count FROM regional_agent_jobs WHERE started_at >= $1`,[wallTime(localDay(now),0)])).rows[0].count;}
  async function locked(fn){
    const db=await pool.connect();let acquired=false;
    try{acquired=(await db.query('SELECT pg_try_advisory_lock($1) AS locked',[LOCK_ID])).rows[0].locked;if(!acquired)return null;return await fn(db);}
    finally{if(acquired)await db.query('SELECT pg_advisory_unlock($1)',[LOCK_ID]).catch(()=>{});db.release();}
  }
  async function tick(){
    if(working||stopped)return;
    working=true;
    try{await locked(async db=>{
      const s=await settings(db);if(!s.enabled)return;
      if(!key()||s.verified_key_hash!==keyHash(key())){
        await db.query("UPDATE regional_agent_settings SET enabled=FALSE,pause_reason='يلزم اختبار اتصال OpenAI قبل تشغيل البحث.' WHERE id=1");return;
      }
      // An abandoned network request may already have incurred cost; never repeat it automatically.
      await db.query("UPDATE regional_agent_jobs SET state='interrupted',finished_at=NOW(),error_message='انقطع التشغيل؛ لم تُعد المحاولة لتجنب تكرار الاستهلاك.' WHERE state='running'");
      const now=new Date(),slot=schedule(now).due;
      if(slot.at>=new Date(s.enabled_at)){
        await db.query('BEGIN');try{await enqueue(db,slot,s);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
      }
      if(await dayCount(db,now)>=s.calls_per_day)return;
      const job=(await db.query(`UPDATE regional_agent_jobs SET state='running',started_at=NOW() WHERE id=(SELECT id FROM regional_agent_jobs WHERE state='pending' ORDER BY id LIMIT 1) RETURNING *`)).rows[0];
      if(!job)return;
      try{
        const target=catalog.findTarget(job.target_id);if(!target)throw Error('المنطقة غير موجودة في الكتالوج.');
        const result=await searchRegion({target,platform:job.platform,key:key(),fetcher});
        await db.query('BEGIN');
        try{
          // A pause during the request still saves discoveries, but leaves them for review.
          const current=await settings(db);
          const count=await saveListings(db,result.listings,current.enabled&&current.auto_publish);
          await db.query(`UPDATE regional_agent_jobs SET state=$1,finished_at=NOW(),published_count=$2,review_count=$3,
            duplicate_count=$4,source_count=$5,response_id=$6,usage=$7 WHERE id=$8`,[result.listings.length?'completed':'empty',count.published,count.review,count.duplicates,result.source_count,result.response_id,JSON.stringify(result.usage),job.id]);
          await db.query('COMMIT');
        }catch(e){await db.query('ROLLBACK');throw e;}
      }catch(error){
        const message=/[\u0600-\u06ff]/.test(error.message)?error.message.slice(0,400):'تعذر إكمال البحث بسبب الاتصال أو معالجة البيانات.';
        await db.query("UPDATE regional_agent_jobs SET state='error',finished_at=NOW(),error_message=$1 WHERE id=$2",[message,job.id]);
        if(error.pause)await db.query('UPDATE regional_agent_settings SET enabled=FALSE,pause_reason=$1 WHERE id=1',[message]);
      }
      await db.query(`UPDATE regional_agent_runs r SET finished_at=NOW() WHERE finished_at IS NULL AND NOT EXISTS(SELECT 1 FROM regional_agent_jobs j WHERE j.run_id=r.id AND j.state IN ('pending','running'))`);
    });}catch(e){console.error('Regional agents tick failed:',e.code||e.name);}
    finally{working=false;}
  }
  function origin(req,res,next){try{if(req.get('origin')&&new URL(req.get('origin')).host!==req.get('host'))return res.status(403).json({error:'افتح لوحة الإدارة من الموقع نفسه.'});}catch{return res.sendStatus(403);}next();}
  const route=handler=>async(req,res)=>{try{res.set('Cache-Control','no-store');await handler(req,res);}catch(error){console.error('Regional agents API:',error.code||error.name);res.status(error.status||500).json({error:/[\u0600-\u06ff]/.test(error.message)?error.message:'تعذر إتمام العملية.'});}};
  app.get('/api/admin/regional-agents',requireAdmin,route(async(_req,res)=>{
    const s=await settings();
    const stats=(await pool.query(`SELECT state,COUNT(*)::int AS count,COALESCE(SUM(published_count),0)::int AS published,COALESCE(SUM(review_count),0)::int AS review FROM regional_agent_jobs GROUP BY state`)).rows;
    const coverage=(await pool.query(`SELECT governorate_id,COUNT(DISTINCT (target_id,platform))::int AS searched,MAX(finished_at) AS last_searched FROM regional_agent_jobs WHERE state IN ('completed','empty') GROUP BY governorate_id`)).rows;
    const jobs=(await pool.query('SELECT * FROM regional_agent_jobs ORDER BY id DESC LIMIT 45')).rows.map(j=>({...j,target_name:catalog.findTarget(j.target_id)?.name||j.target_id}));
    const runs=(await pool.query(`SELECT r.*,COUNT(j.id) FILTER(WHERE j.state IN ('pending','running'))::int AS pending FROM regional_agent_runs r LEFT JOIN regional_agent_jobs j ON j.run_id=r.id GROUP BY r.id ORDER BY r.id DESC LIMIT 10`)).rows;
    res.json({model:MODEL,timezone:TIMEZONE,times:['18:00','23:00'],configured:!!key(),verified:!!key()&&s.verified_key_hash===keyHash(key()),
      settings:{enabled:s.enabled,calls_per_cycle:s.calls_per_cycle,calls_per_day:s.calls_per_day,auto_publish:s.auto_publish,pause_reason:s.pause_reason,verified_at:s.verified_at},
      catalog:catalog.summary(),platforms:catalog.PLATFORMS,total_tasks:TOTAL_TASKS,next_run:schedule().next.at,
      calls_today:await dayCount(),stats,coverage,jobs,runs});
  }));
  app.get('/api/admin/regional-agents/targets',requireAdmin,route(async(req,res)=>{
    const query=String(req.query.q||'').trim(),governorate=String(req.query.governorate||'');
    const all=catalog.targets.filter(t=>(!governorate||t.governorateId===governorate)&&(!query||t.name.includes(query)));
    const page=Math.max(1,Math.floor(Number(req.query.page)||1));res.json({data:all.slice((page-1)*30,page*30),total:all.length,page});
  }));
  app.post('/api/admin/regional-agents/verify',requireAdmin,origin,route(async(_req,res)=>{
    const hash=await verifyKey(key(),fetcher);
    await pool.query('UPDATE regional_agent_settings SET verified_key_hash=$1,verified_at=NOW(),pause_reason=NULL WHERE id=1',[hash]);
    res.json({ok:true,message:'تم تأكيد الوصول إلى Astra. يمكنك تشغيل الجدول.'});
  }));
  app.patch('/api/admin/regional-agents/settings',requireAdmin,origin,route(async(req,res)=>{
    const s=await settings(),body=req.body||{};
    const cycle=body.calls_per_cycle===undefined?s.calls_per_cycle:Number(body.calls_per_cycle),daily=body.calls_per_day===undefined?s.calls_per_day:Number(body.calls_per_day);
    if(!Number.isInteger(cycle)||cycle<1||cycle>1000||!Number.isInteger(daily)||daily<cycle||daily>2000)return res.status(400).json({error:'حد الجولة من 1 إلى1000، وحد اليوم أكبر منه أو يساويه وحتى2000.'});
    for(const field of ['enabled','auto_publish'])if(body[field]!==undefined&&typeof body[field]!=='boolean')return res.status(400).json({error:'إعداد غير صالح.'});
    const enabled=body.enabled??s.enabled;
    if(enabled&&(!key()||s.verified_key_hash!==keyHash(key())))return res.status(409).json({error:'اربط مفتاح OpenAI على الخادم ثم اختبر الاتصال أولًا.'});
    await pool.query(`UPDATE regional_agent_settings SET enabled=$1,enabled_at=CASE WHEN $1 AND NOT enabled THEN NOW() ELSE enabled_at END,
      calls_per_cycle=$2,calls_per_day=$3,auto_publish=$4,pause_reason=NULL,updated_at=NOW() WHERE id=1`,[enabled,cycle,daily,body.auto_publish??s.auto_publish]);
    res.json({ok:true});
  }));
  app.post('/api/admin/regional-agents/run',requireAdmin,origin,route(async(_req,res)=>{
    const s=await settings();if(!s.enabled)return res.status(409).json({error:'شغّل البحث بعد ربط الحساب واختبار الاتصال.'});
    const run=await locked(async db=>{
      if((await db.query("SELECT id FROM regional_agent_jobs WHERE state IN ('pending','running') LIMIT 1")).rows.length)throw Object.assign(Error('توجد جولة قيد التنفيذ أو الانتظار.'),{status:409});
      if(await dayCount(db)>=s.calls_per_day)throw Object.assign(Error('وصلت إلى حد البحث اليومي.'),{status:409});
      await db.query('BEGIN');try{const id=await enqueue(db,{key:'manual-'+crypto.randomUUID(),at:new Date()},await settings(db));await db.query('COMMIT');return id;}catch(e){await db.query('ROLLBACK');throw e;}
    });
    if(!run)return res.status(409).json({error:'البحث يعمل حاليًا. انتظر انتهاء المهمة.'});
    res.status(202).json({ok:true,run_id:run});void tick();
  }));
  console.log('[regional-agents] OpenAI configured='+Boolean(key())+'; schedule=18:00,23:00 Asia/Damascus; activation requires verified admin settings');
  const timer=startTimer?setInterval(()=>void tick(),15000):null;if(timer)timer.unref();
  if(startTimer)void tick();
  return {tick,stop(){stopped=true;if(timer)clearInterval(timer);}};
}
module.exports={register,schedule,wallTime,localDay,taskAt,saveListings,enqueue,TOTAL_TASKS};
