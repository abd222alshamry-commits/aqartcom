'use strict';

const DISCLAIMER = 'تجريبي — للاختبار فقط. هذا فندق افتراضي وليس عرض إقامة حقيقيًا. الأسعار والصور توضيحية ولا تمثل منشأة فعلية.';
const IMAGE = '/assets/property-interior.webp';
const CATALOG = [
  ['damascus', 'دمشق', 40], ['aleppo', 'حلب', 35],
  ['latakia', 'اللاذقية', 50], ['hama', 'حماة', 30],
  ['tartus', 'طرطوس', 45], ['homs', 'حمص', 32],
].map(([key, city, price]) => ({
  slug: `aqartkom-demo-hotel-v1-${key}`,
  name: `تجريبي — فندق عقارتكم ${city}`,
  city,
  description: `${DISCLAIMER} نموذج لاختبار البحث في ${city}، وعرض الغرف والتواريخ والأسعار. لا تستخدم بيانات ضيوف حقيقية أثناء التجربة.`,
  images: [IMAGE],
  rooms: [
    {name:'غرفة فردية تجريبية', room_type:'single', max_guests:1, quantity:5, size_m2:20, bed_type:'سرير فردي', price},
    {name:'غرفة مزدوجة تجريبية', room_type:'double', max_guests:2, quantity:4, size_m2:28, bed_type:'سرير مزدوج', price:price+15},
    {name:'جناح عائلي تجريبي', room_type:'family', max_guests:4, quantity:2, size_m2:48, bed_type:'سرير مزدوج وسريران فرديان', price:price+40},
  ],
}));
const SLUGS = CATALOG.map(h=>h.slug);
const REQUESTED_BATCH = '2026-09-17-six-demo-hotels-approved';

async function transaction(pool, work) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('aqartkom-demo-hotels-v1'))");
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}

async function getExisting(db) {
  const rows = (await db.query('SELECT * FROM hotels WHERE slug=ANY($1::text[])', [SLUGS])).rows;
  for (const row of rows) {
    const definition = CATALOG.find(h=>h.slug===row.slug);
    if (row.name !== definition.name || !String(row.description||'').startsWith(DISCLAIMER)) {
      const error = new Error('يوجد إعلان مختلف يحمل معرّفًا تجريبيًا؛ لم يتم تغيير أي بيانات.');
      error.status = 409;
      throw error;
    }
  }
  return rows;
}

async function list(pool) {
  const rows = await getExisting(pool);
  return rows.map(h=>({id:h.id, name:h.name, city:h.city, status:h.status}));
}

async function create(pool, ownerId, {onceKey}={}) {
  return transaction(pool, async db => {
    if (onceKey && (await db.query('SELECT key FROM app_seed_runs WHERE key=$1',[onceKey])).rows.length) {
      return {created:0, skipped:true};
    }
    const existing = await getExisting(db);
    const office = (await db.query('SELECT id FROM offices WHERE owner_id=$1 ORDER BY id LIMIT 1', [ownerId])).rows[0];
    let created=0;
    for (const h of CATALOG) {
      // Repeated clicks preserve existing rooms, edits, visibility, and bookings.
      if (existing.some(x=>x.slug===h.slug)) continue;
      const hotel = (await db.query(`INSERT INTO hotels
        (office_id,owner_id,name,slug,city,district,address,description,star_rating,amenities,images,check_in_time,check_out_time,cancellation_policy,status,platform_commission_rate)
        VALUES($1,$2,$3,$4,$5,'بيانات تجريبية','عنوان افتراضي للاختبار فقط',$6,0,$7,$8,'14:00','12:00',$9,'active',0) RETURNING id`,
        [office?.id||null,ownerId,h.name,h.slug,h.city,h.description,JSON.stringify(['واي فاي تجريبي','تكييف تجريبي']),JSON.stringify(h.images),'بيانات اختبار فقط؛ لا ينشأ حق إقامة فعلي. يمكن للمدير إلغاء الحجوزات التجريبية.'])).rows[0];
      for (const room of h.rooms) {
        await db.query(`INSERT INTO hotel_rooms
          (hotel_id,name,room_type,description,max_guests,bed_type,size_m2,price,currency,quantity,amenities,images,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,$11,'active')`,
          [hotel.id,room.name,room.room_type,DISCLAIMER,room.max_guests,room.bed_type,room.size_m2,room.price,room.quantity,JSON.stringify(['بيانات للاختبار']),JSON.stringify(h.images)]);
      }
      created++;
    }
    if(onceKey)await db.query('INSERT INTO app_seed_runs(key) VALUES($1)',[onceKey]);
    return {created, existing:existing.length, data:await list(db)};
  });
}

// One explicitly requested production test batch, approved by the site owner.
// The durable marker prevents recreating records after an administrator hides/deletes them.
async function seedRequestedBatch(pool, ownerEmail) {
  if(!ownerEmail)return {created:0,skipped:true,reason:'owner_unavailable'};
  const owner=(await pool.query("SELECT id FROM users WHERE LOWER(email)=LOWER($1) AND role='admin' AND is_active=TRUE",[ownerEmail])).rows[0];
  if(!owner)return {created:0,skipped:true,reason:'owner_unavailable'};
  return create(pool,owner.id,{onceKey:REQUESTED_BATCH});
}

async function hide(pool) {
  return transaction(pool, async db=>{
    const rows=await getExisting(db);
    const changed=await db.query("UPDATE hotels SET status='inactive',updated_at=NOW() WHERE id=ANY($1::bigint[]) AND status<>'inactive' RETURNING id",[rows.map(h=>h.id)]);
    return {hidden:changed.rows.length, data:await list(db)};
  });
}

function register(app, {pool, requireAdmin}) {
  const route=handler=>async(req,res)=>{
    res.set('Cache-Control','no-store');
    try { res.json(await handler(req)); }
    catch(error) { res.status(error.status||500).json({error:error.status?error.message:'تعذر تجهيز بيانات الفنادق التجريبية.'}); }
  };
  app.get('/api/admin/demo-hotels', requireAdmin, route(async()=>({data:await list(pool),catalog:CATALOG.map(h=>({name:h.name,city:h.city,prices:h.rooms.map(r=>r.price),currency:'USD'}))})));
  app.post('/api/admin/demo-hotels', requireAdmin, route(req=>create(pool,req.user.id)));
  app.post('/api/admin/demo-hotels/hide', requireAdmin, route(()=>hide(pool)));
}

module.exports={CATALOG, DISCLAIMER, REQUESTED_BATCH, create, hide, list, register, seedRequestedBatch};
