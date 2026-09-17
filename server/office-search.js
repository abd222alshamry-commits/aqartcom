'use strict';
const {readOfficeListings,publicationTime}=require('./office-listings');
const normalize=value=>String(value||'').trim().replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064B-\u065F]/g,'').toLowerCase();
const contains=(value,term)=>normalize(value).includes(normalize(term));
async function searchOfficeListings(pool,filters,getRate) {
  // Approximate town centers are not suitable for precise distance filtering.
  if(filters.featured==='true'||Number(filters.radiusKm)>0)return [];
  let rows=await readOfficeListings(pool,filters.office||null);
  rows=rows.filter(p=>(!filters.city||p.city===filters.city)&&
    (!filters.district||contains(p.district,filters.district))&&(!filters.type||p.property_type===filters.type)&&
    (!filters.rooms||(p.rooms!=null&&(filters.rooms==='5+'?Number(p.rooms)>=5:Number(p.rooms)===Number(filters.rooms))))&&
    (!filters.mode||({sale:'بيع',rent:'إيجار'}[p.listing_mode]===filters.mode))&&
    (!filters.availability||filters.availability==='all'||p.availability===filters.availability)&&
    (!filters.q||contains([p.title,p.description,p.district,p.advertiser_name].join(' '),filters.q)));
  const currency=filters.currency||'USD';
  const rates=new Map();
  for(const sourceCurrency of new Set(rows.filter(p=>p.price!=null).map(p=>p.currency||'USD'))) {
    rates.set(sourceCurrency,sourceCurrency===currency?1:await getRate(sourceCurrency,currency));
  }
  return rows.map(p=>({...p,id:'market-'+p.id,market_id:p.id,source_kind:'office',
    type:p.property_type,mode:({sale:'بيع',rent:'إيجار'}[p.listing_mode]||'بيع'),
    image_url:p.media?.[0]?.url||null,created_at:new Date(publicationTime(p)).toISOString(),
    price_display:p.price==null?null:Math.round(Number(p.price)*rates.get(p.currency||'USD')*100)/100,display_currency:currency,
    rooms:p.rooms??null,baths:null,observed_at:p.observed_at||null,
    detail_url:'/office-property.html?id='+p.id
  })).filter(p=>(!filters.minPrice||(p.price_display!=null&&p.price_display>=Number(filters.minPrice)))&&
    (!filters.maxPrice||(p.price_display!=null&&p.price_display<=Number(filters.maxPrice))));
}
async function searchOfficeMapListings(pool,filters,getRate) {
  const rows=await searchOfficeListings(pool,{...filters,radiusKm:0},getRate);
  return rows.filter(row=>row.latitude!=null&&row.longitude!=null);
}
module.exports={searchOfficeListings,searchOfficeMapListings};
