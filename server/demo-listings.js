'use strict';

// Explicit, one-time demo import. Never recreates listings the administrator deletes.
const batch = '2026-09-16-ten-listings';
const examples = [
  ['شقة عائلية للبيع في دمشق','شقة','بيع','دمشق','المزة',85000,140,3,2,33.501,36.25,'interior'],
  ['شقة للإيجار في ريف دمشق','شقة','إيجار','ريف دمشق','جرمانا',250,110,2,1,33.485,36.347,'interior'],
  ['شقة واسعة للبيع في حلب','شقة','بيع','حلب','حلب الجديدة',65000,160,3,2,36.2,37.108,'building'],
  ['منزل للبيع في حمص','منزل','بيع','حمص','الوعر',55000,180,4,2,34.74,36.677,'building'],
  ['شقة للإيجار في حماة','شقة','إيجار','حماة','حي البعث',180,100,2,1,35.132,36.759,'interior'],
  ['فيلا للبيع في اللاذقية','فيلا','بيع','اللاذقية','اللاذقية',210000,320,5,3,35.53,35.79,'villa'],
  ['شقة للإيجار في طرطوس','شقة','إيجار','طرطوس','طرطوس',300,120,3,2,34.889,35.887,'interior'],
  ['محل تجاري للبيع في إدلب','محل تجاري','بيع','إدلب','إدلب',35000,60,0,1,35.93,36.634,'interior'],
  ['مكتب للإيجار في درعا','مكتب','إيجار','درعا','درعا',150,75,2,1,32.617,36.105,'interior'],
  ['منزل للبيع في السويداء','منزل','بيع','السويداء','السويداء',70000,200,4,2,32.71,36.568,'building']
];

async function seedDemoListings(pool, enabled = process.env.DEMO_LISTINGS_BATCH) {
  if (enabled !== batch) return {created: 0, skipped: true};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = await client.query('INSERT INTO app_seed_runs(key) VALUES($1) ON CONFLICT DO NOTHING RETURNING key', [batch]);
    if (!run.rows.length) { await client.query('COMMIT'); return {created: 0, skipped: true}; }
    for (const [title,type,mode,city,district,price,area,rooms,baths,lat,lng,image] of examples) {
      await client.query(`INSERT INTO properties(title,type,mode,city,district,price,area,rooms,baths,latitude,longitude,image_url,description,is_demo,status,currency)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,'active','USD')`,
        [title+' — إعلان تجريبي',type,mode,city,district,price,area,rooms,baths,lat,lng,'/assets/property-'+image+'.webp',
        'إعلان تجريبي لعرض وظائف منصة عقاراتكم، وليس عرضًا حقيقيًا للبيع أو الإيجار. الصور توضيحية والموقع تقريبي. السعر والمساحة والمواصفات بيانات افتراضية وليست تقييمًا للسوق.'+(mode==='إيجار'?' السعر الافتراضي للإيجار شهري.':'')]);
    }
    await client.query('COMMIT');
    return {created: examples.length, skipped: false};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = {seedDemoListings, batch};
