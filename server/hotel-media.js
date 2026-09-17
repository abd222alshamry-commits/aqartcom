'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),multer=require('multer');
function signature(b,kind){return kind==='images'?(b.subarray(0,3).equals(Buffer.from([255,216,255]))||b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')):(b.toString('ascii',4,8)==='ftyp'||b.subarray(0,4).equals(Buffer.from([26,69,223,163])));}
function register(app,{pool,requireOfficeMember,ownedHotel,uploadDir,createVideoPoster}){
 async function scope(req,res,next){try{const h=await ownedHotel(req.params.id,req.office);if(!h)return res.status(404).json({error:'الفندق غير موجود'});req.mediaTable=req.params.roomId?'hotel_rooms':'hotels';req.mediaId=req.params.roomId||req.params.id;if(req.params.roomId&&!(await pool.query('SELECT id FROM hotel_rooms WHERE id=$1 AND hotel_id=$2',[req.params.roomId,h.id])).rows[0])return res.status(404).json({error:'الغرفة غير موجودة'});next();}catch(e){res.status(500).json({error:'تعذر التحقق من الفندق'});}}
 for(const base of ['/api/office/hotels/:id','/api/office/hotels/:id/rooms/:roomId']){
  for(const kind of ['images','videos']){
   const limit=kind==='images'?12:3;
   const uploader=multer({storage:multer.diskStorage({destination:uploadDir,filename:(_r,f,cb)=>cb(null,Date.now()+'-'+crypto.randomBytes(8).toString('hex')+path.extname(f.originalname).toLowerCase())}),limits:{files:limit,fileSize:(kind==='images'?8:100)*1024*1024},fileFilter:(_r,f,cb)=>{const ext=path.extname(f.originalname).toLowerCase();const ok=kind==='images'?/\.(jpg|jpeg|png|webp)$/.test(ext)&&/^image\/(jpeg|jpg|png|webp)$/.test(f.mimetype):/\.(mp4|mov|webm)$/.test(ext)&&/^video\/(mp4|quicktime|webm)$/.test(f.mimetype);cb(ok?null:Error('صيغة الملف غير مدعومة'),ok);}}).array(kind,limit);
   app.post(base+'/'+kind,requireOfficeMember,scope,(req,res,next)=>uploader(req,res,e=>e?res.status(400).json({error:'تعذر الرفع: تأكد من الصيغة والعدد وحجم الملف'}):next()),async(req,res)=>{
    let client,transaction=false;const cleanup=(req.files||[]).map(f=>f.path);
    try{
     if(!req.files?.length)return res.status(400).json({error:'اختر ملفات للرفع'});
     const items=[];
     for(const f of req.files){const handle=await fs.open(f.path,'r');const head=Buffer.alloc(12);try{await handle.read(head,0,12,0);}finally{await handle.close();}if(!signature(head,kind))throw Error('محتوى الملف لا يطابق صورة أو فيديو مدعوم');const item={url:'/uploads/'+f.filename};if(kind==='videos'){item.poster_url=await createVideoPoster(f.path);if(!item.poster_url)throw Error('تعذر قراءة الفيديو؛ اختر ملف فيديو صالحًا');cleanup.push(path.join(uploadDir,path.basename(item.poster_url)));}items.push(item);}
     client=await pool.connect();await client.query('BEGIN');transaction=true;
     const row=(await client.query(`SELECT ${kind} FROM ${req.mediaTable} WHERE id=$1 FOR UPDATE`,[req.mediaId])).rows[0];
     const before=row?.[kind]||[];if(!row||before.length+items.length>limit)throw Error('الحد الأقصى '+limit+' ملفات؛ احذف ملفًا قديمًا أولًا');
     const value=[...before,...items];await client.query(`UPDATE ${req.mediaTable} SET ${kind}=$1::jsonb,updated_at=NOW() WHERE id=$2`,[JSON.stringify(value),req.mediaId]);await client.query('COMMIT');transaction=false;
     res.status(201).json({data:items});
    }catch(e){if(transaction)await client.query('ROLLBACK');await Promise.all(cleanup.map(p=>fs.unlink(p).catch(()=>{})));res.status(400).json({error:e.message==='محتوى الملف لا يطابق صورة أو فيديو مدعوم'||e.message.startsWith('الحد الأقصى')||e.message.startsWith('تعذر قراءة الفيديو')?e.message:'تعذر حفظ الوسائط'});}finally{client?.release();}
   });
  }
  app.delete(base+'/media',requireOfficeMember,scope,async(req,res)=>{try{const kind=req.body.kind;if(!['images','videos'].includes(kind))return res.status(400).json({error:'نوع الوسائط غير صحيح'});await pool.query(`UPDATE ${req.mediaTable} SET ${kind}=COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(${kind}) v WHERE COALESCE(v->>'url',v#>>'{}')<>$1),'[]'::jsonb),updated_at=NOW() WHERE id=$2`,[String(req.body.url||''),req.mediaId]);res.json({ok:true});}catch(e){res.status(500).json({error:'تعذر حذف الوسائط'});}});
 }
 app.patch('/api/office/hotels/:id/publication',requireOfficeMember,scope,async(req,res)=>{try{if(req.user.role!=='admin')return res.status(403).json({error:'نشر الفندق متاح للإدارة فقط'});if(!['active','inactive'].includes(req.body.status))return res.status(400).json({error:'حالة غير صحيحة'});const r=await pool.query('UPDATE hotels SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,status',[req.body.status,req.params.id]);res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر تغيير حالة النشر'});}});
}
module.exports={register,signature};
