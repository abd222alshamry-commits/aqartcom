'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {publishedBatches,manualBatch,data:officeData}=require('./office-listings');
const {full}=require('./admin-permissions');
const tables={property:'properties',hotel:'hotels',market:'market_listings'};
const idOK=v=>/^[1-9]\d{0,17}$/.test(String(v||''));
const fail=(status,message)=>Object.assign(new Error(message),{status});
const grant=(user,key)=>full(user)||user.admin_permissions?.includes(key);
function publicURL(value){
 if(!value)return null;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
function text(value,max,required=false){
 if(value!=null&&typeof value!=='string')throw fail(400,'أدخل نصًا صالحًا');
 const v=(value||'').trim();if(v.length>max||(required&&!v))throw fail(400,'أكمل الحقول المطلوبة والتزم بالطول المحدد');return v;
}
function number(value,max,integer=false){
 if(value==null||value==='')return null;
 if(!['number','string'].includes(typeof value)||!String(value).trim())throw fail(400,'قيمة رقمية غير صحيحة');
 const n=Number(value);if(!Number.isFinite(n)||n<0||n>max||(integer&&!Number.isInteger(n)))throw fail(400,'قيمة رقمية غير صحيحة');return n;
}
const queueSQL=`
 SELECT 'property'::text kind,p.id,p.title,p.city,p.type category,p.status,p.created_at,p.updated_at,
 o.name office_name,p.is_demo FROM properties p LEFT JOIN offices o ON o.id=p.office_id WHERE p.deleted_at IS NULL
 UNION ALL
 SELECT 'hotel',h.id,h.name,h.city,h.lodging_type,h.status,h.created_at,h.updated_at,
 o.name,h.slug LIKE 'aqartkom-demo-hotel-v1-%' FROM hotels h LEFT JOIN offices o ON o.id=h.office_id WHERE h.deleted_at IS NULL
 UNION ALL
 SELECT 'market',m.id,m.title,m.city,m.property_type,m.status,m.created_at,m.updated_at,
 COALESCE(o.name,s.name,m.advertiser_name),FALSE FROM market_listings m
 LEFT JOIN offices o ON o.id=m.office_id LEFT JOIN market_sources s ON s.id=m.source_id WHERE m.deleted_at IS NULL`;

// Only listing content is exposed: no reservations, financial records or source credentials.
async function details(db,kind,id,lock=false){
 const table=Object.hasOwn(tables,kind)?tables[kind]:null;if(!table||!idOK(id))throw fail(404,'العرض غير موجود');
 const row=(await db.query(`SELECT * FROM ${table} WHERE id=$1 AND deleted_at IS NULL${lock?' FOR UPDATE':''}`,[id])).rows[0];
 if(!row)throw fail(404,'العرض غير موجود');
 const pick=keys=>Object.fromEntries(keys.map(k=>[k,row[k]??null]));
 const common=['id','city','district','description','status'];let item;
 if(kind==='property'){
  item=pick([...common,'title','type','mode','price','currency','area','rooms','baths','image_url','office_id','is_demo']);
  item.images=(await db.query('SELECT url FROM property_images WHERE property_id=$1 ORDER BY sort_order,id',[id])).rows;
  item.videos=(await db.query('SELECT url,title,poster_url FROM property_videos WHERE property_id=$1 ORDER BY id',[id])).rows;
 }else if(kind==='hotel'){
  item=pick([...common,'name','lodging_type','star_rating','address','images','videos','amenities','rental_terms','cancellation_policy','check_in_time','check_out_time','free_cancel_hours','office_id']);
  item.title=row.name;item.is_demo=row.slug.startsWith('aqartkom-demo-hotel-v1-');
  item.rooms=(await db.query('SELECT id,name,room_type,description,max_guests,price,currency,quantity,status,images,videos FROM hotel_rooms WHERE hotel_id=$1 ORDER BY id',[id])).rows;
 }else{
  item=pick([...common,'title','property_type','listing_mode','price','currency','area','rooms','media','external_url','advertiser_name','phone','whatsapp','office_id','source_id']);
  item.publishable=publishedBatches.includes(row.raw_data?.import_batch);
  item.availability=row.raw_data?.availability||'unconfirmed';
 }
 if(row.office_id)item.office_name=(await db.query('SELECT name FROM offices WHERE id=$1',[row.office_id])).rows[0]?.name||null;
 else if(row.source_id)item.office_name=(await db.query('SELECT name FROM market_sources WHERE id=$1',[row.source_id])).rows[0]?.name||null;
 const history=(await db.query(`SELECT e.id,e.action,e.reason,e.from_status,e.to_status,e.created_at,u.name actor_name
 FROM offer_review_events e LEFT JOIN users u ON u.id=e.actor_user_id
 WHERE e.kind=$1 AND e.offer_id=$2 ORDER BY e.id DESC LIMIT 50`,[kind,id])).rows;
 const revision=createHash('sha256').update(JSON.stringify({item,last:history[0]?.id||null})).digest('hex');
 return {kind,data:item,history,revision};
}

function register(app,{pool,requireAdmin}){
 const handle=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){if(!e.status)console.error('Offer review:',e.message);res.status(e.status||500).json({error:e.status?e.message:'تعذر تنفيذ العملية، حاول مجددًا'});}};
 app.get('/api/admin/offers',requireAdmin,handle(async(req,res)=>{
  const kind=String(req.query.kind||''),status=String(req.query.status||''),q=String(req.query.q||'').trim().slice(0,150);
  if(kind&&!Object.hasOwn(tables,kind))throw fail(400,'نوع عرض غير صحيح');
  if(status&&!['pending','active','published','approved','rejected','inactive','duplicate'].includes(status))throw fail(400,'حالة غير صحيحة');
  const page=Math.max(1,Math.min(100000,Number.parseInt(req.query.page,10)||1)),size=30;
  const where="($1='' OR kind=$1) AND ($2='' OR status=$2) AND ($3='' OR title ILIKE '%'||$3||'%' OR city ILIKE '%'||$3||'%' OR office_name ILIKE '%'||$3||'%')";
  const args=[kind,status,q];
  const total=(await pool.query(`SELECT COUNT(*)::int total FROM (${queueSQL}) offers WHERE ${where}`,args)).rows[0].total;
  const rows=(await pool.query(`SELECT * FROM (${queueSQL}) offers WHERE ${where}
  ORDER BY CASE WHEN status='pending' THEN 0 WHEN status='approved' THEN 1 ELSE 2 END,created_at DESC,kind,id DESC LIMIT $4 OFFSET $5`,[...args,size,(page-1)*size])).rows;
  res.json({data:rows,total,page,page_size:size,can_review:grant(req.user,'offers.review'),can_create:grant(req.user,'offers.create'),can_manage_team:full(req.user)});
 }));
 app.get('/api/admin/offers/offices',requireAdmin,handle(async(_req,res)=>{
  const offices=(await pool.query('SELECT id,name,city,phone,whatsapp FROM offices ORDER BY name,id')).rows.map(o=>({...o,key:'office:'+o.id,label:o.name+' — مكتب مسجل'}));
  const sources=(await pool.query('SELECT id,name,platform,page_url FROM market_sources ORDER BY name,id')).rows.map(s=>({...s,key:'source:'+s.id,label:s.name+' — '+(s.platform==='facebook'?'فيسبوك':'إنستغرام')}));
  res.json({data:[...offices,...sources]});
 }));
 app.post('/api/admin/offers/office-listings',requireAdmin,handle(async(req,res)=>{
  const b=req.body||{},office=text(b.office,40,true),match=office.match(/^(office|source):([1-9]\d{0,17})$/);
  if(!match)throw fail(400,'اختر المكتب التابع له العرض');
  const title=text(b.title,200,true),description=text(b.description,10000,true),city=text(b.city,100,true),district=text(b.district,150);
  const type=text(b.property_type,80,true),mode=text(b.listing_mode,20,true),currency=text(b.currency,10,true);
  if(!['شقة','منزل','فيلا','أرض','مزرعة','محل تجاري','مكتب','بناء','مستودع','شاليه','أخرى'].includes(type)||!['sale','rent'].includes(mode)||!['USD','SYP','EUR','SAR','AED','GBP'].includes(currency))throw fail(400,'نوع العقار أو العملية أو العملة غير صحيح');
  const price=number(b.price,9999999999999),area=number(b.area,9999999999),rooms=number(b.rooms,1000,true);
  const external=text(b.external_url,2000),phone=text(b.phone,40),whatsapp=text(b.whatsapp,40);
  if(external&&!publicURL(external))throw fail(400,'رابط المصدر يجب أن يبدأ بـ https://');
  for(const p of [phone,whatsapp])if(p&&!/^\+[1-9]\d{7,14}$/.test(p))throw fail(400,'اكتب الهاتف مع رمز الدولة مثل +963…');
  const images=b.images||[];
  if(!Array.isArray(images)||images.length>10||images.some(u=>typeof u!=='string'||u.length>2000||!publicURL(u)))throw fail(400,'أضف حتى 10 روابط صور صحيحة تبدأ بـ https://');
  const client=await pool.connect();let result;
  try{
   await client.query('BEGIN');
   const isOffice=match[1]==='office',table=isOffice?'offices':'market_sources';
   const parent=(await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR SHARE`,[match[2]])).rows[0];
   if(!parent)throw fail(404,'المكتب غير موجود، حدّث قائمة المكاتب');
   const known=!isOffice&&officeData.offices.find(o=>o.pageId===parent.page_id);
   const meta={import_batch:manualBatch,office_key:known?.key||(isOffice?'office-':'source-')+parent.id,
    availability:'unconfirmed',media_kind:images.length?'image':'none',created_by:req.user.id};
   result=(await client.query(`INSERT INTO market_listings(office_id,source_id,platform,external_id,external_url,advertiser_name,
    title,description,phone,whatsapp,city,district,property_type,listing_mode,price,currency,area,rooms,media,raw_data,status)
    VALUES($1,$2,'manual_office',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,'pending') RETURNING id,status`,
    [isOffice?parent.id:null,isOffice?null:parent.id,randomUUID(),external||null,parent.name,title,description,
     phone||parent.phone||known?.phones?.[0]||null,whatsapp||parent.whatsapp||known?.whatsapp||null,city,district,type,mode,price,currency,area,rooms,
     JSON.stringify(images.map(url=>({type:'image',url:publicURL(url)}))),JSON.stringify(meta)])).rows[0];
   await client.query("INSERT INTO offer_review_events(kind,offer_id,action,reason,actor_user_id,to_status) VALUES('market',$1,'create',$2,$3,'pending')",[result.id,'إضافة عرض تابع لـ '+parent.name,req.user.id]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  res.status(201).json({data:result,message:'تم حفظ عرض المكتب بانتظار المراجعة'});
 }));
 app.get('/api/admin/offers/:kind/:id',requireAdmin,handle(async(req,res)=>res.json(await details(pool,req.params.kind,req.params.id))));
 app.post('/api/admin/offers/:kind/:id/review',requireAdmin,handle(async(req,res)=>{
  const {kind,id}=req.params,b=req.body||{},reason=text(b.reason,2000),action=b.action;
  if(!['approve','reject','pending'].includes(action))throw fail(400,'قرار غير صحيح');
  if(action!=='approve'&&reason.length<3)throw fail(400,'اكتب سبب الرفض أو الإعادة للمراجعة');
  if(!/^[a-f0-9]{64}$/.test(b.revision||''))throw fail(400,'افتح تفاصيل العرض قبل اتخاذ القرار');
  const client=await pool.connect();let status;
  try{
   await client.query('BEGIN');
   const current=await details(client,kind,id,true);
   if(current.revision!==b.revision)throw fail(409,'تغيّر العرض أو قرار مراجعته. أعد فتح التفاصيل وراجعه مجددًا');
   if(current.data.is_demo&&action==='approve')throw fail(400,'لا يمكن اعتماد عرض تجريبي كعرض حقيقي');
   status=action==='reject'?'rejected':action==='pending'?'pending':kind==='market'?(current.data.publishable?'published':'approved'):'active';
   await client.query(`UPDATE ${tables[kind]} SET status=$1,updated_at=NOW() WHERE id=$2`,[status,id]);
   if(kind==='market'&&status==='published')await client.query(`UPDATE market_listings SET raw_data=CASE WHEN platform='manual_office' THEN raw_data || jsonb_build_object('source_published_at',COALESCE(raw_data->>'source_published_at',to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))) ELSE raw_data END WHERE id=$1`,[id]);
   await client.query('INSERT INTO offer_review_events(kind,offer_id,action,reason,actor_user_id,from_status,to_status) VALUES($1,$2,$3,$4,$5,$6,$7)',[kind,id,action,reason,req.user.id,current.data.status,status]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  res.json({status,message:status==='approved'?'تم اعتماد المراجعة؛ يبقى العرض غير منشور حتى استكمال توثيق مصدره':status==='active'||status==='published'?'تم اعتماد العرض ونشره':status==='rejected'?'تم رفض العرض وإخفاؤه عن الزوار':'أُعيد العرض للمراجعة وأُخفي عن الزوار'});
 }));
}
module.exports={register,details,publicURL};
