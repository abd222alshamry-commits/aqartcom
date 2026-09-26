'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
const {scope,config,validId}=require('./listing-management');
const {candidates,safeUrl,automatic}=require('../listing-cover');
const problem=(status,message)=>Object.assign(Error(message),{status});
async function extractFrame(input,output,seconds){
 await exec('ffmpeg',['-nostdin','-v','error','-threads','1','-protocol_whitelist','file,pipe','-ss',String(seconds),'-i',input,'-map','0:v:0','-frames:v','1','-vf','scale=960:960:force_original_aspect_ratio=decrease','-threads','1','-filter_threads','1','-q:v','3','-y',output],{timeout:25000,maxBuffer:1024*1024});
 const stat=await fs.stat(output);if(!stat.size)throw Error('No frame');
}
function register(app,{pool,requireAuth,mediaStore,uploadDir,frame=extractFrame}){
 async function read(db,user,kind,id,lock=false){
  const c=config(kind);if(!validId(id))throw problem(404,'العرض غير موجود');
  const row=(await db.query(`SELECT p.* FROM ${c.table} p WHERE p.id=$2 AND p.deleted_at IS NULL AND ${scope(user,kind,'edit')} AND $1::bigint>0${lock?' FOR UPDATE OF p':''}`,[user.id,id])).rows[0];
  if(!row)throw problem(404,'العرض غير موجود أو لا تملك صلاحية تعديله');
  if(kind==='property'){
   row.images=(await db.query('SELECT url FROM property_images WHERE property_id=$1 ORDER BY sort_order,id',[id])).rows;
   row.videos=(await db.query('SELECT url,poster_url,title,is_primary FROM property_videos WHERE property_id=$1 ORDER BY is_primary DESC,id',[id])).rows;
  }
  if(kind==='market')row.hosted_video=row.raw_data?.local_video;
  if(kind==='hotel')row.rooms=(await db.query('SELECT images,videos FROM hotel_rooms WHERE hotel_id=$1 ORDER BY id',[id])).rows;
  const media=candidates(row).map(m=>({...m,can_extract:m.type==='video'&&!!mediaStore.keyFromUrl(m.url)}));
  const revision=crypto.createHash('sha256').update(JSON.stringify({media,cover:row.cover_media,updated:row.updated_at})).digest('hex');
  return {row,media,revision};
 }
 const handle=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){if(!e.status)console.error('Listing cover:',e.code||e.name);res.status(e.status||503).json({error:e.status?e.message:'تعذر حفظ صورة العرض. أعد المحاولة.'});}};
 app.get('/api/listing-management/:kind/:id/cover',requireAuth,handle(async(req,res)=>{
  const d=await read(pool,req.user,req.params.kind,req.params.id);res.json({media:d.media,cover:d.row.cover_media,effective_cover:d.row.cover_media||automatic(d.row),revision:d.revision});
 }));
 app.post('/api/listing-management/:kind/:id/cover',requireAuth,handle(async(req,res)=>{
  // Authorize before acquiring upload capacity, reading files or processing video.
  req.coverState=await read(pool,req.user,req.params.kind,req.params.id);
  await new Promise(resolve=>{res.once('finish',resolve);res.once('close',resolve);mediaStore.uploadGate(req,res,()=>{req.coverGate=true;resolve();});});
  if(!req.coverGate)return;
  req.mediaProcessing=true;let client,transaction=false,input,output,committed=false;const batch=mediaStore.batch();
  try{
   const {kind,id}=req.params,body=req.body||{},state=req.coverState;
   if(body.revision!==state.revision)throw problem(409,'تغيّرت وسائط العرض. أعد فتح اختيار الصورة.');
   if(!['image','video','auto'].includes(body.type))throw problem(400,'اختر صورة أو لقطة من فيديو العرض');
   let cover=null;
   if(body.type!=='auto'){
    const selected=state.media.find(m=>m.type===body.type&&m.url===body.url);if(!selected)throw problem(400,'اختر ملفًا محفوظًا ضمن هذا العرض');
    if(selected.type==='image')cover={type:'image',url:selected.url,source_url:selected.url};
    else if(body.seconds==null&&safeUrl(selected.poster))cover={type:'video',url:selected.poster,source_url:selected.url};
    else{
     const seconds=body.seconds==null?0.5:body.seconds;
     if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0||seconds>86400)throw problem(400,'وقت اللقطة غير صحيح');
     if(!selected.can_extract)throw problem(400,'لا يمكن استخراج لقطة من هذا الرابط. ارفع الفيديو إلى العرض أو اختر صورة مرفوعة.');
     input=await mediaStore.readForProcessing(selected.url);
     output=path.join(uploadDir,'cover-'+crypto.randomBytes(16).toString('hex')+'.jpg');
     try{await frame(input.path,output,seconds);}catch{throw problem(400,'تعذر استخراج هذه اللقطة. اختر وقتًا داخل مدة الفيديو أو صورة من العرض.');}
     cover={type:'video',url:await batch.add(output),source_url:selected.url,seconds};
    }
   }
   client=await pool.connect();await client.query('BEGIN');transaction=true;
   const latest=await read(client,req.user,kind,id,true);if(latest.revision!==state.revision)throw problem(409,'تغيّرت وسائط العرض أثناء الحفظ. أعد فتح اختيار الصورة.');
   const nextStatus=kind==='market'&&req.user.role!=='admin'?'pending':latest.row.status;
   await client.query(`UPDATE ${config(kind).table} SET cover_media=$1::jsonb,status=$2,updated_at=NOW() WHERE id=$3`,[cover?JSON.stringify(cover):null,nextStatus,id]);
   await client.query('INSERT INTO offer_review_events(kind,offer_id,action,reason,actor_user_id,from_status,to_status) VALUES($1,$2,$3,$4,$5,$6,$7)',[kind,id,'edit','تحديد صورة العرض',req.user.id,latest.row.status,nextStatus]);
   await client.query('COMMIT');transaction=false;committed=true;await batch.commit();
   const old=state.row.cover_media?.url;
   if(old!==cover?.url&&/^uploads\/cover-[a-f0-9]{32}\.jpg$/.test(mediaStore.keyFromUrl(old)||''))await mediaStore.remove(old).catch(()=>{});
   res.json({ok:true,cover,effective_cover:cover||automatic(latest.row),status:nextStatus,message:kind==='market'&&req.user.role!=='admin'?'حُفظت الصورة وأُرسل العرض للمراجعة.':'تم حفظ صورة العرض.'});
  }finally{
   if(transaction)await client.query('ROLLBACK').catch(()=>{});client?.release();
   if(!committed){await batch.rollback();if(output)await fs.unlink(output).catch(()=>{});}
   await input?.cleanup();req.releaseMediaUpload?.();
  }
 }));
}
module.exports={register,extractFrame};
