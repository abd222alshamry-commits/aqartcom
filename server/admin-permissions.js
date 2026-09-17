'use strict';
const catalog={ 'hotels.read':'عرض الفنادق والغرف والحجوزات','hotels.write':'إضافة وتعديل الفنادق والغرف والوسائط والحجوزات','properties.read':'عرض العقارات','properties.write':'إدارة العقارات','finance.read':'عرض التقارير المالية','users.read':'عرض المستخدمين' };
const full=user=>user?.role==='admin' && user.admin_permissions==null;
function allowed(user,req){
 if(full(user))return true;
 if(user?.role!=='admin'||!Array.isArray(user.admin_permissions))return false;
 const p=(req.originalUrl||req.path||'').split('?')[0],read=['GET','HEAD'].includes(req.method);
 let group=null;
 if(/\/(payments|payouts|finance|commission)(?:\/|$)|\/hotel-(payouts|payments)(?:\/|$)/.test(p))group='finance';
 else if(/^\/api\/office\/hotels?(?:[-/]|$)/.test(p)||/^\/api\/admin\/hotels?(?:[-/]|$)/.test(p))group='hotels';
 else if(/^\/api\/admin\/properties(?:\/|$)/.test(p))group='properties';
 else if(/^\/api\/admin\/(finance|accounting)(?:\/|$)/.test(p))group='finance';
 else if(/^\/api\/admin\/users(?:\/|$)/.test(p))group='users';
 return !!group && user.admin_permissions.includes(group+'.'+(read?'read':'write'));
}
function normalize(value){if(!Array.isArray(value)||value.some(p=>!Object.hasOwn(catalog,p)))throw Error('صلاحيات غير صحيحة');const set=new Set(value);for(const p of set)if(p.endsWith('.write'))set.add(p.replace('.write','.read'));return [...set].sort();}
function register(app,{pool,requireAdmin,bcrypt,ownerEmail}){
 const onlyFull=(req,res,next)=>full(req.user)?next():res.status(403).json({error:'إدارة حسابات الإدارة متاحة للمدير الكامل فقط'});
 app.get('/api/admin/team',requireAdmin,onlyFull,async(req,res)=>{try{res.json({catalog,data:(await pool.query("SELECT id,name,email,is_active,admin_permissions FROM users WHERE role='admin' ORDER BY id")).rows});}catch(e){res.status(500).json({error:'تعذر تحميل فريق الإدارة'});}});
 app.post('/api/admin/team',requireAdmin,onlyFull,async(req,res)=>{try{
  const b=req.body||{},name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),permissions=normalize(b.permissions);
  if(name.length<2||name.length>120||!/^\S+@\S+\.\S+$/.test(email)||email.length>255||password.length<12||Buffer.byteLength(password)>72)return res.status(400).json({error:'أدخل اسمًا وبريدًا صحيحين وكلمة مرور من 12 حرفًا على الأقل ولا تتجاوز 72 بايت'});
  if(email===String(ownerEmail||'').toLowerCase())return res.status(409).json({error:'لا يمكن تعديل حساب المالك بهذه الطريقة'});
  const hash=await bcrypt.hash(password,12);
  const r=await pool.query("WITH changed AS (INSERT INTO users(name,email,password_hash,role,admin_permissions) VALUES($1,$2,$3,'admin',$4::jsonb) RETURNING id,name,email,is_active,admin_permissions), logged AS (INSERT INTO admin_access_events(actor_user_id,target_user_id,permissions,is_active) SELECT $5,id,admin_permissions,is_active FROM changed) SELECT * FROM changed",[name,email,hash,JSON.stringify(permissions),req.user.id]);
  res.status(201).json({data:r.rows[0]});
 }catch(e){res.status(e.code==='23505'?409:400).json({error:e.code==='23505'?'البريد مسجل بالفعل؛ لا يُغيّر الحساب الموجود تلقائيًا':e.message==='صلاحيات غير صحيحة'?e.message:'تعذر إنشاء حساب الإدارة'});}});
 app.patch('/api/admin/team/:id',requireAdmin,onlyFull,async(req,res)=>{try{
  const permissions=normalize(req.body.permissions),active=req.body.is_active;
  if(typeof active!=='boolean')return res.status(400).json({error:'حالة الحساب مطلوبة'});
  const r=await pool.query("WITH changed AS (UPDATE users SET admin_permissions=$1::jsonb,is_active=$2,updated_at=NOW() WHERE id=$3 AND role='admin' AND admin_permissions IS NOT NULL AND id<>$4 AND LOWER(email)<>LOWER($5) RETURNING id,name,email,is_active,admin_permissions), logged AS (INSERT INTO admin_access_events(actor_user_id,target_user_id,permissions,is_active) SELECT $4,id,admin_permissions,is_active FROM changed) SELECT * FROM changed",[JSON.stringify(permissions),active,req.params.id,req.user.id,ownerEmail||'']);
  if(!r.rows[0])return res.status(403).json({error:'يمكن تعديل حساب إدارة محدود فقط؛ حساب المالك والإدارة الكاملة محميان'});
  res.json({data:r.rows[0]});
 }catch(e){res.status(400).json({error:e.message==='صلاحيات غير صحيحة'?e.message:'تعذر تعديل صلاحيات الحساب'});}});
}
module.exports={catalog,full,allowed,normalize,register};
