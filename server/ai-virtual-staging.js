const fs=require('fs');
const path=require('path');
const multer=require('multer');
const crypto=require('crypto');

module.exports=function install(app,{pool,getCurrentUser,requireAdmin}){
 const root=path.join(__dirname,'..','uploads','virtual-staging'); fs.mkdirSync(root,{recursive:true});
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024},fileFilter:(_r,f,cb)=>cb(null,/^image\/(png|jpeg|webp)$/i.test(f.mimetype))});
 const model=process.env.OPENAI_IMAGE_MODEL||'gpt-image-2';
 const approval='أوافق على إضافة التصور';
 const styles={modern:'مودرن عصري',luxury:'فاخر راقٍ',minimal:'مينيمال بسيط',arabic:'عربي معاصر',classic:'كلاسيكي أنيق',renovation:'تجديد وتشطيب حديث'};
 async function schema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_virtual_staging_jobs(
   id BIGSERIAL PRIMARY KEY, property_id BIGINT REFERENCES properties(id) ON DELETE CASCADE, user_id BIGINT,
   source_name TEXT, source_sha256 TEXT, mode TEXT NOT NULL DEFAULT 'staging', style TEXT, room_type TEXT,
   instructions TEXT, model TEXT, status TEXT NOT NULL DEFAULT 'generated', output_path TEXT, output_url TEXT,
   is_ai_visualization BOOLEAN NOT NULL DEFAULT TRUE, approved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ); CREATE INDEX IF NOT EXISTS idx_ai_virtual_staging_property ON ai_virtual_staging_jobs(property_id,created_at DESC);`);
 }
 schema().catch(e=>console.error('V73 schema',e));
 function promptFor(body){
  const mode=body.mode==='renovation'?'renovation':'staging'; const style=styles[body.style]||styles.modern; const room=String(body.room_type||'الغرفة');
  const extra=String(body.instructions||'').slice(0,600);
  return mode==='renovation'
   ?`Edit this real-estate photo into a realistic optional renovation visualization for ${room}, in a ${style} style. Preserve the exact architecture, camera angle, room dimensions, windows, doors, structural walls and perspective. Improve finishes, lighting, flooring and decor only where plausible. Do not add impossible space, views, rooms or structural features. Photorealistic real-estate visualization. ${extra}`
   :`Virtually stage this real-estate photo of ${room} in a ${style} style. Preserve the exact architecture, camera angle, room dimensions, windows, doors, fixed fixtures and perspective. Add realistic furniture, lighting and decor only; do not hide defects or invent structural features, views, extra space, rooms, windows or doors. Photorealistic real-estate visualization. ${extra}`;
 }
 async function canUseProperty(user,id){if(!user)return false;if(user.role==='admin')return true;const q=await pool.query(`SELECT 1 FROM properties WHERE id=$1 AND user_id=$2`,[id,user.id]);return !!q.rowCount}
 app.post('/api/virtual-staging/generate',upload.single('image'),async(req,res)=>{try{
  const user=await getCurrentUser(req); if(!user)return res.status(401).json({error:'يجب تسجيل الدخول'}); if(!req.file)return res.status(400).json({error:'أرفق صورة العقار'});
  const propertyId=Number(req.body.property_id); if(!propertyId||!await canUseProperty(user,propertyId))return res.status(403).json({error:'لا تملك صلاحية هذا العقار'});
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'OPENAI_API_KEY غير مضبوط'});
  const form=new FormData(); form.append('model',model); form.append('prompt',promptFor(req.body)); form.append('image',new Blob([req.file.buffer],{type:req.file.mimetype}),req.file.originalname||'property.jpg'); form.append('size','auto'); form.append('quality','high');
  const r=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form}); const data=await r.json();
  if(!r.ok)throw new Error(data?.error?.message||'OpenAI image edit failed'); const b64=data?.data?.[0]?.b64_json; if(!b64)throw new Error('لم تعد خدمة الصور ملفاً صالحاً');
  const name=`v73-${propertyId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`; fs.writeFileSync(path.join(root,name),Buffer.from(b64,'base64')); const url=`/uploads/virtual-staging/${name}`;
  const sha=crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  const row=(await pool.query(`INSERT INTO ai_virtual_staging_jobs(property_id,user_id,source_name,source_sha256,mode,style,room_type,instructions,model,output_path,output_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[propertyId,user.id,req.file.originalname,sha,req.body.mode==='renovation'?'renovation':'staging',req.body.style||'modern',req.body.room_type||null,String(req.body.instructions||'').slice(0,600),model,path.join(root,name),url])).rows[0];
  res.json({data:row,label:'تصور بالذكاء الاصطناعي',disclaimer:'هذه صورة تصور اختيارية وليست صورة حقيقية للعقار. يجب إبقاء الوسم ظاهراً عند النشر.'});
 }catch(e){console.error('V73 generate',e);res.status(500).json({error:'تعذر إنشاء التصور بالذكاء الاصطناعي'})}});
 app.get('/api/virtual-staging/property/:id',async(req,res)=>{try{const user=await getCurrentUser(req);if(!user||!await canUseProperty(user,Number(req.params.id)))return res.status(403).json({error:'غير مصرح'});const q=await pool.query(`SELECT id,property_id,mode,style,room_type,status,output_url,is_ai_visualization,approved_at,created_at FROM ai_virtual_staging_jobs WHERE property_id=$1 ORDER BY created_at DESC LIMIT 30`,[req.params.id]);res.json({data:q.rows,label:'تصور بالذكاء الاصطناعي'})}catch(e){res.status(500).json({error:'تعذر تحميل التصورات'})}});
 app.post('/api/virtual-staging/:id/approve',async(req,res)=>{try{const user=await getCurrentUser(req);if(!user)return res.status(401).json({error:'يجب تسجيل الدخول'});if(String(req.body?.confirmation||'')!==approval)return res.status(400).json({error:`للموافقة اكتب: ${approval}`});const j=(await pool.query(`SELECT * FROM ai_virtual_staging_jobs WHERE id=$1`,[req.params.id])).rows[0];if(!j||!await canUseProperty(user,Number(j.property_id)))return res.status(403).json({error:'غير مصرح'});const q=await pool.query(`UPDATE ai_virtual_staging_jobs SET status='approved',approved_at=NOW() WHERE id=$1 RETURNING *`,[j.id]);res.json({data:q.rows[0],label:'تصور بالذكاء الاصطناعي',notice:'تم اعتماد التصور داخل الاستوديو. يجب عرضه دائماً بوسم واضح ولا يحل محل الصور الأصلية.'})}catch(e){res.status(500).json({error:'تعذر اعتماد التصور'})}});
 app.get('/api/admin/virtual-staging',requireAdmin,async(req,res)=>{try{const q=await pool.query(`SELECT j.id,j.property_id,p.title,j.mode,j.style,j.status,j.output_url,j.created_at,j.approved_at FROM ai_virtual_staging_jobs j LEFT JOIN properties p ON p.id=j.property_id ORDER BY j.created_at DESC LIMIT 100`);res.json({data:q.rows})}catch(e){res.status(500).json({error:'تعذر تحميل AI Virtual Staging'})}});
 return {schema};
}
