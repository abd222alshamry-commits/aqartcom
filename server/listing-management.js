'use strict';
const {createHash} = require('node:crypto');
const {full} = require('./admin-permissions');
const configs = {
 property: {table:'properties',group:'properties',title:'title',fields:['title','type','mode','city','district','price','currency','area','rooms','baths','description','latitude','longitude']},
 market: {table:'market_listings',group:'offers',title:'title',fields:['title','property_type','listing_mode','city','district','price','currency','area','rooms','description','phone','whatsapp']},
 hotel: {table:'hotels',group:'hotels',title:'name',fields:['name','city','district','address','description','lodging_type','rental_terms','cancellation_policy']}
};
const error = (status,message) => Object.assign(new Error(message),{status});
const validId = id => /^[1-9]\d{0,17}$/.test(String(id||''));
function config(kind) { if(!Object.hasOwn(configs,kind)) throw error(404,'الإعلان غير موجود'); return configs[kind]; }
function adminGrant(user,kind,operation) {
 if(full(user))return true;
 return user?.role==='admin' && (user.admin_permissions?.includes('offers.'+operation) ||
   (kind!=='market' && user.admin_permissions?.includes(config(kind).group+'.write')));
}
function scope(user,kind,operation) {
 if(user.role==='admin')return adminGrant(user,kind,operation)?'TRUE':'FALSE';
 const own=kind==='market'?'FALSE':'p.owner_id=$1';
 return `(${own} OR EXISTS (SELECT 1 FROM offices o WHERE o.id=p.office_id AND o.owner_id=$1))`;
}
function projection(kind) {
 const c=config(kind);
 return ['id','status','updated_at',...c.fields].map(f=>'p.'+f).join(',');
}
function revision(data) { return createHash('sha256').update(JSON.stringify(data)).digest('hex'); }
function validate(kind,input,current) {
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length)throw error(400,'عدّل أحد الحقول قبل الحفظ');
 const c=config(kind),out={},limits={title:200,name:180,type:80,property_type:80,mode:30,listing_mode:30,city:100,district:120,currency:10,description:10000,address:1000,rental_terms:10000,cancellation_policy:10000,phone:40,whatsapp:40,lodging_type:40};
 for(const [key,value] of Object.entries(input)) {
  if(!c.fields.includes(key))throw error(400,'لا يمكن تعديل هذا الحقل من الإعلان');
  if(['price','area','rooms','baths','latitude','longitude'].includes(key)) {
   if(value===''||value===null){if(key==='price'&&kind==='property')throw error(400,'السعر مطلوب');out[key]=null;continue;}
   const max={price:999999999999,area:9999999999,rooms:1000,baths:1000,latitude:90,longitude:180}[key];
   if(!['string','number'].includes(typeof value)||!String(value).trim()||!Number.isFinite(Number(value))||Math.abs(Number(value))>max||(!['latitude','longitude'].includes(key)&&Number(value)<0)||(['rooms','baths'].includes(key)&&!Number.isInteger(Number(value))))throw error(400,'أدخل قيمة رقمية صحيحة للسعر أو المساحة أو الموقع');
   out[key]=Number(value);
  }else{
   if(typeof value!=='string'||value.trim().length>limits[key])throw error(400,'أدخل نصًا صحيحًا ضمن الطول المسموح');
   out[key]=value.trim();
   if(['title','name','city','type','property_type','mode','listing_mode','currency','lodging_type'].includes(key)&&!out[key])throw error(400,'العنوان والمدينة والنوع والعملة حقول مطلوبة');
  }
 }
 if(out.mode&&!['بيع','إيجار'].includes(out.mode)||out.listing_mode&&!['sale','rent'].includes(out.listing_mode)||out.lodging_type&&!['hotel','furnished_apartment','farm'].includes(out.lodging_type))throw error(400,'نوع الإعلان أو العملية غير صحيح');
 if(out.currency&&!['USD','SYP','EUR','SAR','AED','GBP','KWD','QAR','BHD','OMR','JOD','CAD','AUD','JPY','CHF','SGD'].includes(out.currency))throw error(400,'العملة غير مدعومة');
 for(const key of ['phone','whatsapp'])if(out[key]&&!/^\+[1-9]\d{7,14}$/.test(out[key]))throw error(400,'اكتب رقم التواصل مع رمز الدولة مثل +963…');
 if(kind==='property'){
  const merged={...current,...out},lat=merged.latitude,lng=merged.longitude;
  if((lat==null)!==(lng==null))throw error(400,'أدخل إحداثيي الموقع معًا أو اتركهما فارغين');
 }
 return out;
}
function publicPath(kind,id){return kind==='property'?'/property.html?id='+id:kind==='market'?'/office-property.html?id='+id:'/hotels.html?hotel='+id;}
function register(app,{pool,requireAuth,getCurrentUser}) {
 const handle=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){if(!e.status)console.error('Listing management:',e.message);res.status(e.status||500).json({error:e.status?e.message:'تعذر تنفيذ العملية. حاول مجددًا'});}};
 async function read(db,user,kind,id,operation='edit',lock=false){
  const c=config(kind);if(!validId(id))throw error(404,'الإعلان غير موجود');
  const row=(await db.query(`SELECT ${projection(kind)} FROM ${c.table} p WHERE p.id=$2 AND p.deleted_at IS NULL AND ${scope(user,kind,operation)} AND $1::bigint>0${lock?' FOR UPDATE OF p':''}`,[user.id,id])).rows[0];
  if(!row)throw error(404,'الإعلان غير موجود أو لا تملك صلاحية إدارته');return row;
 }
 app.get('/api/listing-management',requireAuth,handle(async(req,res)=>{
  const kind=String(req.query.kind||''),q=String(req.query.q||'').trim().slice(0,150),page=Math.max(1,Math.min(100000,parseInt(req.query.page,10)||1));
  if(kind)config(kind);
  const sql=Object.keys(configs).filter(k=>!kind||k===kind).map(k=>{
   const c=configs[k],edit=scope(req.user,k,'edit'),del=scope(req.user,k,'delete');
   return `SELECT '${k}'::text kind,p.id,p.${c.title} title,p.city,p.status,p.updated_at,(${edit}) can_edit,(${del}) can_delete FROM ${c.table} p WHERE p.deleted_at IS NULL AND ((${edit}) OR (${del})) AND $1::bigint>0`;
  }).join(' UNION ALL ');
  const where="($2='' OR title ILIKE '%'||$2||'%' OR city ILIKE '%'||$2||'%')";
  const total=(await pool.query(`SELECT COUNT(*)::int n FROM (${sql}) x WHERE ${where}`,[req.user.id,q])).rows[0].n;
  const rows=(await pool.query(`SELECT * FROM (${sql}) x WHERE ${where} ORDER BY updated_at DESC,kind,id DESC LIMIT 30 OFFSET $3`,[req.user.id,q,(page-1)*30])).rows;
  res.json({data:rows.map(r=>({...r,url:publicPath(r.kind,r.id)})),total,page,page_size:30});
 }));
 app.post('/api/listing-management/capabilities',handle(async(req,res)=>{
  const user=await getCurrentUser(req),items=req.body?.items;
  if(!Array.isArray(items)||items.length>60||items.some(x=>!x||!Object.hasOwn(configs,x.kind)||!validId(x.id)))throw error(400,'قائمة إعلانات غير صحيحة');
  if(!user)return res.json({data:[]});
  const data=[];
  for(const kind of Object.keys(configs)){
   const ids=items.filter(x=>x.kind===kind).map(x=>String(x.id));if(!ids.length)continue;
   const rows=(await pool.query(`SELECT p.id,(${scope(user,kind,'edit')}) can_edit,(${scope(user,kind,'delete')}) can_delete FROM ${config(kind).table} p WHERE p.id=ANY($2::bigint[]) AND p.deleted_at IS NULL AND $1::bigint>0`,[user.id,ids])).rows;
   data.push(...rows.filter(r=>r.can_edit||r.can_delete).map(r=>({...r,kind})));
  }
  res.json({data});
 }));
 app.get('/api/listing-management/:kind/:id',requireAuth,handle(async(req,res)=>{
  const {kind,id}=req.params;
  // A delete-only administrator can inspect exactly what they are about to remove.
  const operation=req.user.role==='admin'&&!adminGrant(req.user,kind,'edit')?'delete':'edit';
  const data=await read(pool,req.user,kind,id,operation);
  res.json({data,kind,revision:revision(data),url:publicPath(kind,id)});
 }));
 for(const method of ['patch','delete'])app[method]('/api/listing-management/:kind/:id',requireAuth,handle(async(req,res)=>{
  const {kind,id}=req.params,c=config(kind),operation=method==='patch'?'edit':'delete';
  if(!/^[a-f0-9]{64}$/.test(req.body?.revision||''))throw error(400,'افتح الإعلان مجددًا قبل إجراء التغيير');
  const db=await pool.connect();let result;
  try{
   await db.query('BEGIN');const current=await read(db,req.user,kind,id,operation,true);
   if(revision(current)!==req.body.revision)throw error(409,'تغيّر الإعلان منذ فتحه. افتحه مجددًا لمراجعة أحدث البيانات');
   if(method==='patch'){
    const changes=validate(kind,req.body.changes,current),keys=Object.keys(changes),values=Object.values(changes);
    // Office partners cannot bypass moderation by editing an approved source listing.
    const nextStatus=kind==='market'&&req.user.role!=='admin'?'pending':current.status;
    values.push(nextStatus,id);
    result=(await db.query(`UPDATE ${c.table} SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')},status=$${values.length-1},updated_at=NOW()${kind==='hotel'?',terms_version=terms_version+1':''} WHERE id=$${values.length} RETURNING status`,values)).rows[0];
   }else{
    result=(await db.query(`UPDATE ${c.table} SET deleted_at=NOW(),status=$1,updated_at=NOW() WHERE id=$2 RETURNING status`,[kind==='hotel'?'inactive':'rejected',id])).rows[0];
   }
   await db.query('INSERT INTO offer_review_events(kind,offer_id,action,reason,actor_user_id,from_status,to_status) VALUES($1,$2,$3,$4,$5,$6,$7)',[kind,id,operation,operation==='delete'?'حذف الإعلان من العرض العام مع الاحتفاظ بالسجل':'تعديل بيانات الإعلان',req.user.id,current.status,result.status]);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  res.json({ok:true,status:result.status,message:method==='delete'?'تم حذف الإعلان من الموقع':kind==='market'&&req.user.role!=='admin'?'تم حفظ التعديل وإرساله للمراجعة':'تم حفظ تعديل الإعلان'});
 }));
}
module.exports={register,validate,adminGrant};
