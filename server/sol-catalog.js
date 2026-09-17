'use strict';
const {readOfficeListings}=require('./office-listings');
// A public, bounded snapshot. No account, reservation, payment or unpublished data.
function register(app,{pool}){
 app.get('/api/sol/catalog',async(_req,res)=>{try{
  const [properties,hotels,market]=await Promise.all([
   pool.query(`SELECT p.id,p.title,p.type,p.mode,p.city,p.district,p.price,p.currency,p.area,p.rooms,
    LEFT(p.description,500) description,o.name office_name FROM properties p LEFT JOIN offices o ON o.id=p.office_id
    WHERE p.status='active' AND p.is_demo=FALSE ORDER BY p.created_at DESC,p.id DESC LIMIT 200`),
   pool.query(`SELECT h.id,h.name title,h.lodging_type type,h.city,h.district,LEFT(h.description,500) description,
    h.rental_terms,h.cancellation_policy,h.star_rating FROM hotels h
    WHERE h.status='active' AND h.slug NOT LIKE 'aqartkom-demo-hotel-v1-%' ORDER BY h.created_at DESC,h.id DESC LIMIT 200`),
   readOfficeListings(pool)
  ]);
  const rows=[...properties.rows.map(p=>({...p,kind:'property',key:'property-'+p.id,url:'/property.html?id='+p.id})),
   ...hotels.rows.map(h=>({...h,kind:'hotel',key:'hotel-'+h.id,url:'/hotels.html',price:null,mode:'إيجار'})),
   ...market.filter(m=>m.availability!=='sold').slice(0,200).map(m=>({id:m.id,key:'market-'+m.id,kind:'market',title:m.title,
    type:m.property_type,mode:m.listing_mode==='rent'?'إيجار':'بيع',city:m.city,district:m.district,price:m.price,currency:m.currency,
    area:m.area,rooms:m.rooms,description:String(m.description||'').slice(0,500),office_name:m.advertiser_name,url:'/office-property.html?id='+m.id}))];
  res.set('Cache-Control','no-store');res.json({version:1,saved_at:new Date().toISOString(),limit_per_section:200,data:rows,
   note:'عينة من أحدث العروض العامة، حتى 200 لكل قسم. الأسعار والتوفر يحتاجان تأكيدًا عند عودة الاتصال.'});
 }catch(e){console.error('Sol catalog:',e.message);res.status(503).json({error:'تعذر تحديث العروض؛ يمكنك استخدام النسخة المحفوظة'});}});
}
module.exports={register};
