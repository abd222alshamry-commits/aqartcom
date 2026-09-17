'use strict';

const data = require('./office-listings-data.json');
const {withApproximateLocation}=require('./listing-location');
const enabledBatch = '2026-09-16-marei-public-references';
const regionalBatch = 'regional-astra-v1';
const publishedBatches = Object.freeze([data.snapshot, regionalBatch]);

// Relative Facebook dates are anchored to the review, never to today's date.
// This value is only an ordering key; it is not presented as an exact post time.
function publicationTime(item) {
  const absolute = Date.parse(item.source_published_at || '');
  if (Number.isFinite(absolute)) return absolute;
  const label = String(item.published_label || '').replace(/[٠-٩]/g, digit => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
  const relative = label.match(/^منذ (?:(\d+) )?(ساعات|ساعة|ساعتين|أيام|يومين|يوم)(?:\s|$)/);
  if (!relative) return 0;
  const amount = relative[1] ? Number(relative[1]) : /ين$/.test(relative[2]) ? 2 : 1;
  const unit = relative[2].startsWith('سا') ? 3600000 : 86400000;
  const observed = Date.parse(item.observed_at || data.observedAt);
  return Number.isFinite(observed) ? observed - amount * unit : 0;
}

async function seedOfficeListings(pool, enabled = process.env.MAREI_LISTINGS_BATCH) {
  if (enabled !== enabledBatch) return {created:0, skipped:true};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = await client.query('INSERT INTO app_seed_runs(key) VALUES($1) ON CONFLICT DO NOTHING RETURNING key',[data.snapshot]);
    if (!run.rows.length) { await client.query('COMMIT'); return {created:0, skipped:true}; }
    let created = 0;
    for (const office of data.offices) {
      await client.query(`INSERT INTO market_sources(platform,name,page_id,page_url,is_active)
        VALUES('facebook',$1,$2,$3,FALSE) ON CONFLICT DO NOTHING`,[office.name,office.pageId,office.pageUrl]);
      const source = (await client.query("SELECT id FROM market_sources WHERE platform='facebook' AND page_id=$1",[office.pageId])).rows[0];
      for (const item of data.listings.filter(x => x.office === office.key)) {
        const metadata = {import_batch:data.snapshot,office_key:office.key,offer_number:item.offer,
          source_published_at:item.date,published_label:item.publishedLabel,curation_rank:item.rank,
          observed_at:data.observedAt,evidence:'public_facebook_page',availability:item.availability,
          thumbnail_kind:item.thumbnailKind,video_duration:item.duration};
        const media = [{type:'image',url:item.thumbnail,alt:'صورة من فيديو '+item.title}];
        const result = await client.query(`INSERT INTO market_listings(source_id,platform,external_id,external_url,
          advertiser_name,title,description,phone,whatsapp,city,district,property_type,listing_mode,price,currency,area,media,status,raw_data)
          VALUES($1,'facebook',$2,$3,$4,$5,$6,$7,$8,'طرطوس',$9,$10,'sale',$11,'USD',$12,$13,'published',$14)
          ON CONFLICT(platform,external_id) DO UPDATE SET
            source_id=EXCLUDED.source_id,external_url=EXCLUDED.external_url,advertiser_name=EXCLUDED.advertiser_name,
            title=EXCLUDED.title,description=EXCLUDED.description,phone=EXCLUDED.phone,whatsapp=EXCLUDED.whatsapp,
            district=EXCLUDED.district,property_type=EXCLUDED.property_type,price=EXCLUDED.price,
            currency=EXCLUDED.currency,area=EXCLUDED.area,media=EXCLUDED.media,
            raw_data=market_listings.raw_data || EXCLUDED.raw_data,updated_at=NOW()
          RETURNING id`,[source.id,item.id,item.sourceUrl,office.name,item.title,item.description,
          office.phones[0],office.whatsapp,item.district,item.propertyType,item.price,item.area,JSON.stringify(media),JSON.stringify(metadata)]);
        created += result.rows.length;
      }
    }
    // Directly observed in the original Facebook post during this review.
    await client.query(`UPDATE market_listings SET raw_data=raw_data || $1::jsonb,updated_at=NOW()
      WHERE platform='facebook' AND external_id='1027851283381825'`,
      [JSON.stringify({availability:'sold',availability_observed_at:data.observedAt})]);
    await client.query('COMMIT');
    return {created, skipped:false};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

const publicColumns = `m.id,m.platform,m.title,m.description,m.external_url,m.advertiser_name,
  m.phone,m.whatsapp,m.city,m.district,m.property_type,m.listing_mode,m.price,m.currency,m.area,m.media,
  m.raw_data->>'office_key' AS office_key,m.raw_data->>'offer_number' AS offer_number,
  m.raw_data->>'source_published_at' AS source_published_at,m.raw_data->>'published_label' AS published_label,
  m.raw_data->>'observed_at' AS observed_at,m.raw_data->>'availability' AS availability,
  m.raw_data->>'video_duration' AS video_duration,m.raw_data->>'governorate_id' AS governorate_id,
  m.raw_data->>'locality_id' AS locality_id,
  COALESCE(m.raw_data->>'media_kind',CASE WHEN m.raw_data->>'import_batch'=$1 THEN 'video' ELSE 'none' END) AS media_kind,
  m.raw_data->'local_video' AS hosted_video`;
const publishedWhere = "m.status='published' AND m.raw_data->>'import_batch'=ANY($2::text[])";

async function readOfficeListings(pool,officeKey) {
  const result = await pool.query(`SELECT ${publicColumns} FROM market_listings m
    WHERE ${publishedWhere} AND ($3::text IS NULL OR m.raw_data->>'office_key'=$3)
    ORDER BY m.id DESC`,[data.snapshot,publishedBatches,officeKey||null]);
  return result.rows.map(withApproximateLocation).sort((a,b)=>publicationTime(b)-publicationTime(a) || Number(b.id)-Number(a.id));
}

async function readOfficeListing(pool,id) {
  if (!/^\d+$/.test(String(id || ''))) return null;
  const result = await pool.query(`SELECT ${publicColumns} FROM market_listings m
    WHERE ${publishedWhere} AND m.id=$3::bigint`,[data.snapshot,publishedBatches,String(id)]);
  return result.rows[0] ? withApproximateLocation(result.rows[0]) : null;
}

function registerOfficeListings(app,pool) {
  async function respond(req,res,officeKey) {
    try {
      const rows = await readOfficeListings(pool,officeKey);
      res.set('Cache-Control','no-store');
      const observedAt=rows.reduce((latest,row)=>Date.parse(row.observed_at)>(Date.parse(latest)||0)?row.observed_at:latest,null);
      res.json({data:rows,offices:data.offices,observed_at:observedAt,
        availability:'unconfirmed',source_name:officeKey==='marei'?'مكتب مرعي العقاري':undefined});
    } catch (error) { console.error('Public office listings:',error.message);res.status(500).json({error:'تعذر تحميل إعلانات المكاتب'}); }
  }
  app.get('/api/market/offices',(req,res)=>respond(req,res));
  app.get('/api/market/listings/:id',async(req,res)=>{
    try {
      if(!/^\d+$/.test(req.params.id))return res.status(404).json({error:'الإعلان غير موجود'});
      const item=await readOfficeListing(pool,req.params.id);
      if(!item)return res.status(404).json({error:'الإعلان غير موجود أو أُخفي'});
      res.set('Cache-Control','no-store');res.json({data:item,observed_at:item.observed_at||null});
    } catch(error){res.status(500).json({error:'تعذر تحميل الإعلان'});}
  });
  app.get('/api/market/marei',(req,res)=>respond(req,res,'marei'));
}

module.exports={data,enabledBatch,regionalBatch,publishedBatches,seedOfficeListings,registerOfficeListings,readOfficeListings,readOfficeListing,publicationTime};
