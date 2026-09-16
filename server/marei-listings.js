'use strict';

// One-time, manually curated public references. No Facebook account or automatic sync.
// Only facts visible in indexed source titles/excerpts are included; availability is unknown.
const batch = '2026-09-16-marei-public-references';
const pageId = '100069723124560';
const sourceName = 'مكتب مرعي العقاري';
const listings = [
  {offer:367, id:'1810607023405847', date:'2026-09-06', title:'شقتان على الهيكل في مشتى الحلو',
    description:'يتناول العرض شقتين على الهيكل في الطابق الأول الفني. يذكر المنشور مساحة 200 م² دون أن يتضح من المقتطف هل تخص كل شقة أم الشقتين معًا؛ يرجى سؤال المكتب.',
    url:'https://www.facebook.com/100069723124560/videos/عرض-رقم-367-عقارات_سورياالموقع-مشتى-الحلو-للبيع-شقتين-على-الهيكل-مساحة-٢٠٠-م٢-طا/1810607023405847/'},
  {offer:364, id:'1027851283381825', date:'2026-08-05', area:100, title:'شقة على الهيكل بمساحة 100 م²',
    description:'عرض بيع لشقة على الهيكل في مشتى الحلو. المساحة المنشورة 100 متر مربع. تفاصيل الطابق والتوزيع تؤخذ من المكتب.',
    url:'https://www.facebook.com/100069723124560/videos/عرض-رقم-364-عقارات_سورياالموقع-مشتى-الحلو-للبيع-شقة-على-الهيكلالمساحة-100-م٢-الم/1027851283381825/'},
  {offer:349, id:'1079964937799307', date:'2026-07-01', title:'شقة على الهيكل في الطابق الثالث',
    description:'شقة معروضة للبيع في مشتى الحلو، على الهيكل وفي الطابق الثالث بحسب عنوان الإعلان. لم تظهر المساحة كاملة في المصدر المتاح.',
    url:'https://www.facebook.com/100069723124560/videos/عرض-رقم-349-عقارات_سورياالموقع-مشتى-الحلو-للبيع-شقة-على-الهيكل-طابق-تالتمساحة-12/1079964937799307/'},
  {offer:338, id:'1906491556700934', date:'2026-06-17', district:'مشتى الحلو — نزلة بيت عواد', title:'شقة جاهزة في نزلة بيت عواد',
    description:'عرض لشقة سكنية جاهزة للبيع في مشتى الحلو، بمنطقة نزلة بيت عواد. يمكن مشاهدة تفاصيل العقار في المنشور الأصلي.',
    url:'https://www.facebook.com/100069723124560/videos/عرض-رقم-338-عقارات_سورياالموقع-مشتى-الحلو-نزلة-بيت-عواد-للبيع-شقة-سكنية-جاهزة-بح/1906491556700934/'},
  {offer:324, id:'1381050910500984', date:'2026-05-28', area:125, title:'شقة 125 م² قرب ساحة مشتى الحلو',
    description:'شقة سكنية للبيع بمساحة 125 مترًا مربعًا، ويذكر الإعلان أنها تبعد نحو 200 متر عن ساحة مشتى الحلو. تفاصيل الملكية والتوفر تحتاج إلى تأكيد المكتب.',
    url:'https://www.facebook.com/100069723124560/videos/عرض-رقم-324-عقارات_سورياالموقع-مشتى-الحلو-️-للبيع-شقة-سكنية-تبعد-عن-ساحة-مشتى-ا/1381050910500984/'},
  {offer:318, id:'2145824836204320', date:'2026-05-22', area:50, district:'مشتى الحلو — العوجان', title:'سويت مفروش 50 م² في العوجان',
    description:'سويت مفروش معروض للبيع في منطقة العوجان بمشتى الحلو. المساحة المذكورة في الإعلان 50 مترًا مربعًا.',
    url:'https://www.facebook.com/100069723124560/videos/عرض-رقم-318-عقارت_سوريا-الموقع-مشتى-الحلو-العوجان-للبيع-سويت-مفروش-المساحة-٥٠-م٢/2145824836204320/'},
  {offer:313, id:'1492121232647879', title:'سويت جاهز بدون فرش في مشتى الحلو',
    description:'عرض بيع لسويت جاهز وغير مفروش في مشتى الحلو. لم يظهر السعر أو المساحة في المقتطف المتاح.',
    url:'https://www.facebook.com/100069723124560/videos/عرض-رقم-313-عقارات_سوريا-الموقع-مشتى-الحلو-للبيع-سويت-جاهز-بدون-فرش-الملكية-طابو/1492121232647879/'}
];

async function seedMareiListings(pool, enabled = process.env.MAREI_LISTINGS_BATCH) {
  if (enabled !== batch) return {created:0, skipped:true};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = await client.query('INSERT INTO app_seed_runs(key) VALUES($1) ON CONFLICT DO NOTHING RETURNING key',[batch]);
    if (!run.rows.length) { await client.query('COMMIT'); return {created:0, skipped:true}; }
    await client.query(`INSERT INTO market_sources(platform,name,page_id,page_url,is_active)
      VALUES('facebook',$1,$2,$3,FALSE) ON CONFLICT DO NOTHING`,[sourceName,pageId,'https://www.facebook.com/100069723124560/']);
    const source = (await client.query("SELECT id FROM market_sources WHERE platform='facebook' AND page_id=$1",[pageId])).rows[0];
    let created=0;
    for (const item of listings) {
      const metadata={import_batch:batch,offer_number:item.offer,source_published_at:item.date||null,
        observed_at:'2026-09-16',evidence:'public_search_excerpt',availability:'unconfirmed'};
      const result=await client.query(`INSERT INTO market_listings(source_id,platform,external_id,external_url,
        advertiser_name,title,description,city,district,property_type,listing_mode,area,status,raw_data)
        VALUES($1,'facebook',$2,$3,$4,$5,$6,'طرطوس',$7,'شقة','sale',$8,'published',$9)
        ON CONFLICT(platform,external_id) DO NOTHING RETURNING id`,
        [source.id,item.id,item.url,sourceName,item.title,item.description,item.district||'مشتى الحلو',item.area||null,JSON.stringify(metadata)]);
      created+=result.rows.length;
    }
    await client.query('COMMIT');
    return {created,skipped:false};
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function registerMareiListings(app,pool) {
  app.get('/api/market/marei',async(_req,res)=>{
    try {
      const result=await pool.query(`SELECT m.id,m.title,m.description,m.external_url,m.advertiser_name,
        m.city,m.district,m.property_type,m.listing_mode,m.price,m.currency,m.area,
        m.raw_data->>'offer_number' AS offer_number,
        m.raw_data->>'source_published_at' AS source_published_at
        FROM market_listings m JOIN market_sources s ON s.id=m.source_id
        WHERE m.status='published' AND s.platform='facebook' AND s.page_id=$1
        ORDER BY m.raw_data->>'source_published_at' DESC NULLS LAST,m.id DESC LIMIT 100`,[pageId]);
      res.set('Cache-Control','no-store');
      res.json({data:result.rows,availability:'unconfirmed',source_name:sourceName});
    } catch(error) { console.error('Public market listings:',error.message);res.status(500).json({error:'تعذر تحميل إعلانات المكتب'}); }
  });
}

module.exports={batch,listings,seedMareiListings,registerMareiListings};
