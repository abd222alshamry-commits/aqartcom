const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const multer=require('multer');

module.exports=function installOwnershipVerification(app,{pool,getCurrentUser,requireAdmin}){
 const privateDir=path.join(__dirname,'..','private_uploads','verification');
 fs.mkdirSync(privateDir,{recursive:true});
 const storage=multer.diskStorage({destination:(_r,_f,cb)=>cb(null,privateDir),filename:(_r,f,cb)=>cb(null,`${Date.now()}-${crypto.randomBytes(12).toString('hex')}${path.extname(f.originalname).toLowerCase()}`)});
 const upload=multer({storage,limits:{fileSize:10*1024*1024},fileFilter:(_r,f,cb)=>cb(null,['application/pdf','image/jpeg','image/png','image/webp'].includes(f.mimetype))});
 let ready=false;
 async function ensure(){if(ready)return;await pool.query(`
 CREATE TABLE IF NOT EXISTS verification_documents(
  id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,office_id BIGINT REFERENCES offices(id) ON DELETE CASCADE,
  property_id BIGINT REFERENCES properties(id) ON DELETE CASCADE,document_type VARCHAR(40) NOT NULL,document_number VARCHAR(120),
  owner_name VARCHAR(180),issuer VARCHAR(180),issued_at DATE,expires_at DATE,file_path TEXT NOT NULL,file_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',review_notes TEXT,reviewed_by BIGINT REFERENCES users(id),reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_verification_doc_hash ON verification_documents(file_hash);
 CREATE INDEX IF NOT EXISTS idx_verification_property ON verification_documents(property_id,status);
 CREATE TABLE IF NOT EXISTS property_ownership_checks(
  property_id BIGINT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,ownership_status VARCHAR(30) NOT NULL DEFAULT 'unverified',
  ownership_score INTEGER NOT NULL DEFAULT 0,owner_name_match BOOLEAN,document_reuse_risk BOOLEAN NOT NULL DEFAULT FALSE,
  conflicting_properties JSONB NOT NULL DEFAULT '[]'::jsonb,signals JSONB NOT NULL DEFAULT '[]'::jsonb,verified_document_id BIGINT REFERENCES verification_documents(id),
  verified_by BIGINT REFERENCES users(id),verified_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS verification_audit(
  id BIGSERIAL PRIMARY KEY,actor_user_id BIGINT REFERENCES users(id),action VARCHAR(60) NOT NULL,entity_type VARCHAR(30) NOT NULL,
  entity_id BIGINT NOT NULL,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_level VARCHAR(20) NOT NULL DEFAULT 'unverified';
 ALTER TABLE offices ADD COLUMN IF NOT EXISTS verification_level VARCHAR(20) NOT NULL DEFAULT 'unverified';
 ALTER TABLE properties ADD COLUMN IF NOT EXISTS ownership_verified BOOLEAN NOT NULL DEFAULT FALSE;
 `);ready=true}
 async function auth(req,res,next){try{const u=await getCurrentUser(req);if(!u)return res.status(401).json({error:'يجب تسجيل الدخول أولاً'});req.user=u;next()}catch(e){res.status(500).json({error:'تعذر التحقق من المستخدم'})}}
 const hashFile=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 async function recalc(propertyId){await ensure();const p=(await pool.query(`SELECT p.*,u.name account_owner_name FROM properties p LEFT JOIN users u ON u.id=p.owner_id WHERE p.id=$1`,[propertyId])).rows[0];if(!p)return null;
  const docs=(await pool.query(`SELECT * FROM verification_documents WHERE property_id=$1 ORDER BY created_at DESC`,[propertyId])).rows;const approved=docs.find(d=>d.status==='approved'&&d.document_type==='ownership');
  let score=0,signals=[],reuse=false,conflicts=[];if(approved){score=75;signals.push({code:'approved_ownership_document',label:'وثيقة ملكية معتمدة'});
   const reused=(await pool.query(`SELECT DISTINCT property_id FROM verification_documents WHERE file_hash=$1 AND property_id IS NOT NULL AND property_id<>$2`,[approved.file_hash,propertyId])).rows.map(x=>Number(x.property_id));
   if(reused.length){reuse=true;conflicts=reused;score-=45;signals.push({code:'document_reuse',label:'المستند مستخدم لعقار آخر',property_ids:reused})}
   const a=String(approved.owner_name||'').trim().toLowerCase(),b=String(p.account_owner_name||'').trim().toLowerCase();const match=!!a&&!!b&&(a===b||a.includes(b)||b.includes(a));if(match){score+=20;signals.push({code:'owner_name_match',label:'اسم المالك متوافق'})}else if(a&&b){score-=20;signals.push({code:'owner_name_mismatch',label:'اسم المالك في الوثيقة لا يطابق اسم الحساب'})}
   score=Math.max(0,Math.min(100,score));const status=!reuse&&match&&score>=80?'verified':'review_required';
   await pool.query(`INSERT INTO property_ownership_checks(property_id,ownership_status,ownership_score,owner_name_match,document_reuse_risk,conflicting_properties,signals,verified_document_id,verified_by,verified_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) ON CONFLICT(property_id) DO UPDATE SET ownership_status=EXCLUDED.ownership_status,ownership_score=EXCLUDED.ownership_score,owner_name_match=EXCLUDED.owner_name_match,document_reuse_risk=EXCLUDED.document_reuse_risk,conflicting_properties=EXCLUDED.conflicting_properties,signals=EXCLUDED.signals,verified_document_id=EXCLUDED.verified_document_id,verified_by=EXCLUDED.verified_by,verified_at=EXCLUDED.verified_at,updated_at=NOW()`,[propertyId,status,score,match,reuse,JSON.stringify(conflicts),JSON.stringify(signals),approved.id,approved.reviewed_by,approved.reviewed_at]);
   await pool.query(`UPDATE properties SET ownership_verified=$1 WHERE id=$2`,[status==='verified',propertyId]);return{property_id:Number(propertyId),ownership_status:status,ownership_score:score,owner_name_match:match,document_reuse_risk:reuse,conflicting_properties:conflicts,signals};}
  await pool.query(`INSERT INTO property_ownership_checks(property_id,ownership_status,ownership_score,signals) VALUES($1,'unverified',0,'[]') ON CONFLICT(property_id) DO UPDATE SET ownership_status='unverified',ownership_score=0,updated_at=NOW()`,[propertyId]);await pool.query(`UPDATE properties SET ownership_verified=FALSE WHERE id=$1`,[propertyId]);return{property_id:Number(propertyId),ownership_status:'unverified',ownership_score:0};}
 app.post('/api/verification/property/:id/document',auth,upload.single('document'),async(req,res)=>{try{await ensure();if(!req.file)return res.status(400).json({error:'الوثيقة مطلوبة'});const p=(await pool.query(`SELECT id,owner_id,office_id FROM properties WHERE id=$1`,[req.params.id])).rows[0];if(!p)return res.status(404).json({error:'العقار غير موجود'});if(req.user.role!=='admin'&&Number(p.owner_id)!==Number(req.user.id))return res.status(403).json({error:'لا تملك صلاحية هذا العقار'});const h=hashFile(req.file.path);const row=(await pool.query(`INSERT INTO verification_documents(user_id,office_id,property_id,document_type,document_number,owner_name,issuer,issued_at,expires_at,file_path,file_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,status,document_type,created_at`,[req.user.id,p.office_id,p.id,String(req.body.document_type||'ownership'),req.body.document_number||null,req.body.owner_name||null,req.body.issuer||null,req.body.issued_at||null,req.body.expires_at||null,req.file.path,h])).rows[0];await pool.query(`INSERT INTO verification_audit(actor_user_id,action,entity_type,entity_id,details) VALUES($1,'document_uploaded','property',$2,$3)`,[req.user.id,p.id,JSON.stringify({document_id:row.id,type:row.document_type})]);res.json({ok:true,document:row,message:'تم رفع الوثيقة للمراجعة'})}catch(e){console.error(e);res.status(500).json({error:e.message})}});
 app.get('/api/property/:id/ownership-badge',async(req,res)=>{try{await ensure();const row=(await pool.query(`SELECT ownership_status,ownership_score,verified_at FROM property_ownership_checks WHERE property_id=$1`,[req.params.id])).rows[0];res.json(row||{ownership_status:'unverified',ownership_score:0})}catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/admin/verification/ownership',requireAdmin,async(req,res)=>{try{await ensure();const rows=(await pool.query(`SELECT d.id,d.property_id,d.document_type,d.document_number,d.owner_name,d.issuer,d.status,d.created_at,p.title,p.city,u.name account_owner_name,c.ownership_status,c.ownership_score,c.document_reuse_risk,c.conflicting_properties FROM verification_documents d JOIN properties p ON p.id=d.property_id LEFT JOIN users u ON u.id=p.owner_id LEFT JOIN property_ownership_checks c ON c.property_id=p.id WHERE d.document_type='ownership' ORDER BY CASE d.status WHEN 'pending' THEN 0 ELSE 1 END,d.created_at DESC LIMIT 300`)).rows;res.json({items:rows})}catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/admin/verification/documents/:id/review',requireAdmin,async(req,res)=>{try{await ensure();const status=['approved','rejected'].includes(req.body.status)?req.body.status:null;if(!status)return res.status(400).json({error:'الحالة غير صالحة'});const d=(await pool.query(`UPDATE verification_documents SET status=$1,review_notes=$2,reviewed_by=$3,reviewed_at=NOW() WHERE id=$4 RETURNING *`,[status,req.body.notes||null,req.user.id,req.params.id])).rows[0];if(!d)return res.status(404).json({error:'الوثيقة غير موجودة'});const check=d.property_id?await recalc(d.property_id):null;await pool.query(`INSERT INTO verification_audit(actor_user_id,action,entity_type,entity_id,details) VALUES($1,$2,'document',$3,$4)`,[req.user.id,status==='approved'?'document_approved':'document_rejected',d.id,JSON.stringify({property_id:d.property_id,notes:req.body.notes||null})]);res.json({ok:true,document:{id:d.id,status:d.status},ownership:check})}catch(e){console.error(e);res.status(500).json({error:e.message})}});
 app.get('/api/admin/verification/documents/:id/file',requireAdmin,async(req,res)=>{try{await ensure();const d=(await pool.query(`SELECT file_path FROM verification_documents WHERE id=$1`,[req.params.id])).rows[0];if(!d||!fs.existsSync(d.file_path))return res.status(404).end();res.sendFile(path.resolve(d.file_path))}catch(e){res.status(500).json({error:e.message})}});
 ensure().catch(console.error);return{recalc};
};
