'use strict';
const {mediaPath} = require('./media-storage');

function collectMedia(value, keys, allowedOrigins) {
  if (typeof value==='string') {
    let candidate=value;
    if (candidate.startsWith('https://')) {
      try {const url=new URL(candidate);if(!allowedOrigins.has(url.origin)||url.search||url.hash)return;candidate=url.pathname;}catch{return;}
    }
    const key=candidate.startsWith('/')?mediaPath(candidate.slice(1)):null;
    if(key)keys.add(key);
    // Older JSON columns can contain an encoded JSON array.
    else if(candidate.startsWith('[')) {try{collectMedia(JSON.parse(candidate),keys,allowedOrigins);}catch{}}
  } else if(Array.isArray(value)) value.forEach(item=>collectMedia(item,keys,allowedOrigins));
  else if(value && typeof value==='object') {
    for(const field of ['url','poster_url','poster']) collectMedia(value[field],keys,allowedOrigins);
  }
}
async function publicMediaKeys(pool, origins=[]) {
  const keys=new Set(),allowed=new Set(origins.filter(Boolean).map(v=>new URL(v).origin));
  // Deliberate whitelist. Never scan/copy uploads wholesale: verification and payment documents can live there.
  const queries=[
    'SELECT image_url AS media FROM properties',
    'SELECT url AS media FROM property_images',
    'SELECT url AS media,poster_url AS poster FROM property_videos',
    'SELECT images AS media,videos FROM hotels',
    'SELECT images AS media,videos FROM hotel_rooms',
    "SELECT raw_data->'local_video' AS media FROM market_listings"
  ];
  for(const sql of queries) for(const row of (await pool.query(sql)).rows) for(const value of Object.values(row)) collectMedia(value,keys,allowed);
  return [...keys].sort();
}
module.exports={publicMediaKeys,collectMedia};
