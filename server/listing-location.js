'use strict';

const governorates = require('../geography-provenance/governorates.json');
const localities = require('../geography-provenance/localities.json');
const normalize = value => String(value || '').normalize('NFKC').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const names = row => [row.name?.ar,row.name?.en,...(row.aliases || []).map(alias=>alias.value)].filter(Boolean).map(normalize);
const governorateById = new Map(governorates.map(row=>[row.id,row]));
const localityById = new Map(localities.map(row=>[row.id,row]));
const governorateNames = new Map();
const localityNames = new Map();
for (const row of governorates) for (const name of names(row)) governorateNames.set(name,row);
for (const row of localities) for (const name of new Set(names(row))) {
  const key=row.governorateId+'|'+name;
  if (!localityNames.has(key)) localityNames.set(key,[]);
  localityNames.get(key).push(row);
}
function distanceKm(a,b) {
  const radians=x=>x*Math.PI/180;
  const h=Math.sin(radians(b.latitude-a.latitude)/2)**2+Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(radians(b.longitude-a.longitude)/2)**2;
  return 12742*Math.asin(Math.sqrt(Math.min(1,h)));
}
// A display range around the documented center, not an administrative boundary
// or an assertion about the property's distance from that center.
const governorateRanges = new Map(governorates.map(gov=>[gov.id,Math.ceil(Math.max(10,...localities.filter(row=>row.governorateId===gov.id).map(row=>distanceKm(gov.centroid,row.centroid)+5))/5)*5000]));
const absent = reason => ({latitude:null,longitude:null,location_approximate:true,location_accuracy:'unknown',location_label:'الموقع غير محدد',location_radius_m:null,location_reason:reason});

function approximateLocation(listing) {
  const raw=listing.raw_data || {};
  const governorateId=listing.governorate_id || raw.governorate_id;
  const localityId=listing.locality_id || raw.locality_id;
  const idLocality=localityById.get(localityId);
  const namedGovernorate=governorateNames.get(normalize(listing.city));
  const governorate=governorateById.get(governorateId) || namedGovernorate || (idLocality && governorateById.get(idLocality.governorateId));
  if (!governorate) return absent('unknown_governorate');
  if (namedGovernorate && namedGovernorate.id!==governorate.id) return absent('conflicting_governorate');
  let locality=null, reason='governorate_only';
  if (idLocality && idLocality.governorateId===governorate.id) locality=idLocality;
  else if (localityId) reason='unverified_locality';
  else {
    const district=normalize(listing.district);
    const parts=[district,...district.split(/\s*[—–/,،]\s*/)].map(value=>value.replace(/^جبل\s+/,''));
    const matches=parts.map(part=>localityNames.get(governorate.id+'|'+part)||[]);
    const contexts=matches.flat().filter(row=>matches.some(group=>group.length===1 && group[0].id===row.id));
    // A second named locality in the address may disambiguate a repeated village
    // name, but an office's name/address must never locate its advertised property.
    for (const group of matches) {
      const scoped=group.length>1?group.filter(row=>contexts.some(context=>context.subdistrictId===row.subdistrictId)):group;
      if (scoped.length===1) locality=scoped[0];
      else if (group.length>1) reason='ambiguous_locality';
    }
  }
  if (locality) return {
    latitude:locality.centroid.latitude,longitude:locality.centroid.longitude,
    governorate_id:governorate.id,locality_id:locality.id,location_approximate:true,
    location_accuracy:'locality',location_label:locality.name.ar || locality.name.en,
    location_radius_m:5000,location_reason:'named_locality'
  };
  return {
    latitude:governorate.centroid.latitude,longitude:governorate.centroid.longitude,
    governorate_id:governorate.id,locality_id:null,location_approximate:true,
    location_accuracy:'governorate',location_label:'محافظة '+governorate.name.ar,
    location_radius_m:governorateRanges.get(governorate.id),location_reason:reason
  };
}
function withApproximateLocation(listing) { return {...listing,...approximateLocation(listing)}; }
function withFallbackLocation(listing) {
  const valid=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value));
  if (valid(listing.latitude)&&valid(listing.longitude)&&Math.abs(Number(listing.latitude))<=90&&Math.abs(Number(listing.longitude))<=180) {
    return {...listing,location_accuracy:'provided',location_approximate:false,location_radius_m:null,
      location_label:[listing.city,listing.district].filter(Boolean).join(' — '),location_reason:'provided_coordinates'};
  }
  return withApproximateLocation(listing);
}
module.exports={approximateLocation,withApproximateLocation,withFallbackLocation};
