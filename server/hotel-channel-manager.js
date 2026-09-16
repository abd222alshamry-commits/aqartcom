const crypto=require('crypto');

function providerConfig(provider){
  const p=String(provider||'').toLowerCase();
  const env={
    booking:{base:process.env.BOOKING_API_BASE_URL||'https://supply-xml.booking.com', token:process.env.BOOKING_API_TOKEN, hotel:process.env.BOOKING_HOTEL_ID},
    agoda:{base:process.env.AGODA_API_BASE_URL||'https://supply.agoda.com', token:process.env.AGODA_ACCESS_TOKEN||process.env.AGODA_API_KEY, hotel:process.env.AGODA_HOTEL_ID},
    expedia:{base:process.env.EXPEDIA_API_BASE_URL||'https://integrations.expediaconnectivity.com', token:process.env.EXPEDIA_API_TOKEN, hotel:process.env.EXPEDIA_HOTEL_ID}
  };
  return env[p]||null;
}
function headers(provider){const c=providerConfig(provider);const h={'Accept':'application/json','Content-Type':'application/json','User-Agent':'Aqartkom-ChannelManager/21'};if(c?.token)h.Authorization=`Bearer ${c.token}`;return h}
async function httpJson(url,options={}){const r=await fetch(url,{...options,headers:{...headers(options.provider),...(options.headers||{})}});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch(_){data={raw:text}}if(!r.ok){const e=new Error(`${r.status} ${r.statusText}`);e.status=r.status;e.body=data;throw e}return data}
function bookingRateXml({roomId,ratePlanId,from,to,price,inventory,currency='USD'}){return `<?xml version="1.0" encoding="UTF-8"?><request><version>1.1</version><room id="${roomId}"><date from="${from}" to="${to}"><rate id="${ratePlanId}"/><roomstosell>${Math.max(0,Math.min(254,Number(inventory)||0))}</roomstosell><price>${Number(price).toFixed(2)}</price><currencycode>${currency}</currencycode><closed>${inventory<=0?1:0}</closed></date></room></request>`}
function agodaXml(map,from,to,price,inventory){return `<?xml version="1.0" encoding="UTF-8"?><request timestamp="${Date.now()}" type="10"><criteria property_id="${map.external_hotel_id}"><rate><update room_id="${map.external_room_id}" rateplan_id="${map.external_rate_plan_id}"><date_range from="${from}" to="${to}"/><prices currency="${map.currency||'USD'}"><normal><occupancy person="1" price="${price}"/></normal></prices></update></rate><inventory><update room_id="${map.external_room_id}"><date_values><value>${from}</value></date_values><allotment>${inventory}</allotment><restrictions><closed>${inventory<=0?'true':'false'}</closed></restrictions></update></inventory></criteria></request>`}
function expediaPayload(map,from,to,price,inventory){return {propertyId:map.external_hotel_id,unitId:map.external_room_id,ratePlanId:map.external_rate_plan_id,startDate:from,endDate:to,rate:price,availableInventory:inventory};}
async function pushInventory(pool,map,from,to,price,inventory){
  const p=map.provider; const c=providerConfig(p); if(!c?.token) throw new Error(`${p}: API credentials are not configured`);
  let result;
  if(p==='booking'){
    const xml=bookingRateXml({roomId:map.external_room_id,ratePlanId:map.external_rate_plan_id,from,to,price,inventory,currency:map.currency||'USD'});
    result=await httpJson(`${c.base}/hotels/xml/availability`,{provider:p,method:'POST',headers:{'Content-Type':'application/xml','Accept-Version':'1.1'},body:xml});
  } else if(p==='agoda'){
    const key=process.env.AGODA_API_KEY; if(!key) throw new Error('agoda: AGODA_API_KEY is required for YCS XML API'); const xml=agodaXml(map,from,to,price,inventory); result=await fetch(`${c.base}/api?apiKey=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/xml','Accept':'application/xml','User-Agent':'Aqartkom-ChannelManager/21'},body:xml}).then(async r=>{const t=await r.text();if(!r.ok)throw new Error(`Agoda ${r.status}: ${t.slice(0,500)}`);return {raw:t};});
  } else {
    const url=process.env.EXPEDIA_ARI_URL; if(!url) throw new Error('expedia: EXPEDIA_ARI_URL must be configured from your Expedia Connectivity contract'); result=await httpJson(url,{provider:p,method:'POST',body:JSON.stringify(expediaPayload(map,from,to,price,inventory))});
  }
  return result;
}
async function syncHotel(pool,hotelId,{from,to}={}){
  const start=from||new Date().toISOString().slice(0,10), end=to||new Date(Date.now()+365*86400000).toISOString().slice(0,10);
  const maps=(await pool.query(`SELECT * FROM hotel_channel_mappings WHERE hotel_id=$1 AND is_active=TRUE ORDER BY provider,id`,[hotelId])).rows;
  const run=(await pool.query(`INSERT INTO hotel_channel_sync_runs(hotel_id,run_type,status,started_at) VALUES($1,'push','running',NOW()) RETURNING id`,[hotelId])).rows[0].id;
  let sent=0,failed=0;
  try{
    for(const m of maps){
      const room=(await pool.query(`SELECT * FROM hotel_rooms WHERE id=$1`,[m.room_id])).rows[0]; if(!room)continue;
      const dates=[];for(let d=new Date(start+'T00:00:00Z');d<new Date(end+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1))dates.push(d.toISOString().slice(0,10));
      for(const day of dates){
        const next=new Date(day+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);const day2=next.toISOString().slice(0,10);
        const booked=(await pool.query(`SELECT COALESCE(SUM(rooms_count),0)::int n FROM hotel_bookings WHERE room_id=$1 AND status IN ('pending','confirmed') AND check_in <= $2::date AND check_out > $2::date`,[room.id,day])).rows[0].n;
        const blocked=(await pool.query(`SELECT COALESCE(SUM(quantity),0)::int n FROM hotel_availability_blocks WHERE room_id=$1 AND start_date <= $2::date AND end_date > $2::date`,[room.id,day])).rows[0].n;
        const inventory=Math.max(0,Number(room.quantity)-Number(booked)-Number(blocked));
        const rate=(await pool.query(`SELECT price,currency FROM hotel_room_rates WHERE room_id=$1 AND start_date <= $2::date AND end_date > $2::date ORDER BY created_at DESC LIMIT 1`,[room.id,day])).rows[0]||room;
        try{await pushInventory(pool,m,day,day2,Number(rate.price),inventory);sent++;await pool.query(`INSERT INTO hotel_channel_sync_items(run_id,mapping_id,start_date,end_date,inventory,price,status) VALUES($1,$2,$3,$4,$5,$6,'success')`,[run,m.id,day,day2,inventory,Number(rate.price)]);}catch(e){failed++;await pool.query(`INSERT INTO hotel_channel_sync_items(run_id,mapping_id,start_date,end_date,inventory,price,status,error_message) VALUES($1,$2,$3,$4,$5,$6,'error',$7)`,[run,m.id,day,day2,inventory,Number(rate.price),String(e.message).slice(0,1000)]);}
      }
      await pool.query(`UPDATE hotel_channel_mappings SET last_synced_at=NOW(),last_error=NULL WHERE id=$1`,[m.id]);
    }
    await pool.query(`UPDATE hotel_channel_sync_runs SET finished_at=NOW(),status=$1,sent_count=$2,failed_count=$3 WHERE id=$4`,[failed?'partial':'success',sent,failed,run]);
    return {run_id:run,sent,failed};
  }catch(e){await pool.query(`UPDATE hotel_channel_sync_runs SET finished_at=NOW(),status='error',error_message=$1 WHERE id=$2`,[String(e.message).slice(0,1000),run]);throw e;}
}
function xmlUnescape(s){return String(s||'').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function xmlValue(raw,names){for(const n of names){const a=new RegExp(`<${n}[^>]*?>([\\s\\S]*?)</${n}>`,'i').exec(raw||'');if(a)return xmlUnescape(a[1].replace(/<[^>]+>/g,'').trim());}return null;}
function xmlAttrValue(raw,names,attr){for(const n of names){const re=new RegExp(`<${n}\\b[^>]*?\\b${attr}=["']([^"']+)["']`,'i');const m=re.exec(raw||'');if(m)return xmlUnescape(m[1]);}return null;}
function normalizeReservationPayload(provider,payload){
  if(typeof payload==='string'){
    const raw=payload;
    const status=xmlAttrValue(raw,['HotelReservation','HotelResModify','booking'],'ResStatus')||xmlAttrValue(raw,['booking'],'status')||xmlValue(raw,['Status','ReservationStatus'])||'confirmed';
    const external_id=xmlAttrValue(raw,['HotelReservationID','HotelReservation'],'ResID_Value')||xmlAttrValue(raw,['booking'],'booking_id')||xmlValue(raw,['BookingID','ReservationID','HotelReservationID']);
    const hotel_id=xmlAttrValue(raw,['BasicPropertyInfo','Property','property'],'HotelCode')||xmlAttrValue(raw,['property'],'id')||xmlAttrValue(raw,['Hotel'],'HotelCode')||xmlAttrValue(raw,['booking'],'property_id');
    const external_room_id=xmlAttrValue(raw,['RoomType','RoomStay','room'],'RoomTypeCode')||xmlAttrValue(raw,['RoomType','room'],'room_id')||xmlAttrValue(raw,['Room'],'RoomTypeCode');
    const check_in=xmlAttrValue(raw,['TimeSpan','StayDateRange'],'Start')||xmlAttrValue(raw,['booking'],'arrival')||xmlValue(raw,['Arrival','CheckIn','check_in']);
    const check_out=xmlAttrValue(raw,['TimeSpan','StayDateRange'],'End')||xmlAttrValue(raw,['booking'],'departure')||xmlValue(raw,['Departure','CheckOut','check_out']);
    const guest_name=xmlValue(raw,['GivenName','GuestName','PrimaryGuest','guest_name'])||'External guest';
    const email=xmlValue(raw,['Email','EmailAddress','guest_email']);
    const phone=xmlValue(raw,['Phone','Telephone','guest_phone']);
    const adults=xmlAttrValue(raw,['GuestCount','GuestCounts'],'AdultCount')||xmlAttrValue(raw,['GuestCount'],'adult')||xmlAttrValue(raw,['booking'],'adults')||1;
    const children=xmlAttrValue(raw,['GuestCount','GuestCounts'],'ChildCount')||xmlAttrValue(raw,['booking'],'children')||0;
    const rooms_count=xmlAttrValue(raw,['RoomStay','RoomType','booking'],'Quantity')||xmlAttrValue(raw,['booking'],'rooms_count')||1;
    return {external_id,hotel_id,external_room_id,check_in,check_out,guest_name,guest_email:email,guest_phone:phone,adults,children,rooms_count,status:String(status).toLowerCase().includes('cancel')?'cancelled':String(status).toLowerCase().includes('amend')?'amended':'confirmed',raw_xml:raw};
  }
  return payload||{};
}
async function refreshAffectedInventory(pool,hotelId,from,to){
  if(!from||!to)return;
  const maps=(await pool.query(`SELECT * FROM hotel_channel_mappings WHERE hotel_id=$1 AND is_active=TRUE`,[hotelId])).rows;
  const daily=await buildDailyInventory(pool,hotelId,String(from).slice(0,10),String(to).slice(0,10));
  for(const m of maps){
    const rows=daily.filter(x=>x.room.id===m.room_id); let i=0;
    while(i<rows.length){let j=i+1;while(j<rows.length&&rows[j].inventory===rows[i].inventory&&rows[j].price===rows[i].price&&rows[j].currency===rows[i].currency)j++;const a=rows[i],z=rows[j-1];
      try{const next=new Date(z.day+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);await pushInventory(pool,{...m,currency:a.currency},a.day,isoDate(next),a.price,a.inventory);await pool.query(`UPDATE hotel_channel_mappings SET last_synced_at=NOW(),last_error=NULL WHERE id=$1`,[m.id]);}catch(e){await pool.query(`UPDATE hotel_channel_mappings SET last_error=$1 WHERE id=$2`,[String(e.message).slice(0,1000),m.id]);} i=j;
    }
  }
}
async function ingestExternalBooking(pool,provider,payload){
  const p=String(provider).toLowerCase(); const x=normalizeReservationPayload(p,payload);
  const externalId=String(x.external_id||''); if(!externalId)throw new Error('external booking id required');
  const hotelIdText=String(x.hotel_id||'');
  const maps=(await pool.query(`SELECT * FROM hotel_channel_mappings WHERE provider=$1 AND external_hotel_id=$2 AND is_active=TRUE ORDER BY id`,[p,hotelIdText])).rows;
  if(!maps.length)throw new Error(`No active ${p} mapping for external hotel ${hotelIdText}`);
  const roomMap=x.external_room_id?maps.find(m=>String(m.external_room_id)===String(x.external_room_id)):maps[0];
  if(!roomMap)throw new Error(`No active ${p} room mapping for external room ${x.external_room_id}`);
  const client=await pool.connect();
  try{
    await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock($1)',[Number(roomMap.room_id)]);
    const existing=(await client.query(`SELECT * FROM hotel_external_reservations WHERE provider=$1 AND external_booking_id=$2 FOR UPDATE`,[p,externalId])).rows[0];
    const status=String(x.status||'confirmed').toLowerCase();
    if(existing){
      if(existing.local_booking_id){
        const newStatus=status==='cancelled'?'cancelled':'confirmed';
        await client.query(`UPDATE hotel_bookings SET check_in=COALESCE($1,check_in),check_out=COALESCE($2,check_out),adults=COALESCE($3,adults),children=COALESCE($4,children),rooms_count=COALESCE($5,rooms_count),status=$6,guest_name=COALESCE($7,guest_name),guest_email=COALESCE($8,guest_email),guest_phone=COALESCE($9,guest_phone),updated_at=NOW() WHERE id=$10`,[x.check_in||null,x.check_out||null,Number(x.adults)||1,Number(x.children)||0,Number(x.rooms_count)||1,newStatus,x.guest_name||null,x.guest_email||null,x.guest_phone||null,existing.local_booking_id]);
      }
      await client.query(`UPDATE hotel_external_reservations SET status=$1,payload=$2,updated_at=NOW() WHERE id=$3`,[status,JSON.stringify(x),existing.id]); await client.query('COMMIT');
      if(status!=='cancelled')await refreshAffectedInventory(pool,existing.hotel_id,x.check_in,x.check_out);
      else await refreshAffectedInventory(pool,existing.hotel_id,x.check_in,x.check_out);
      return {updated:true,id:existing.id,local_booking_id:existing.local_booking_id,status};
    }
    if(status==='cancelled'){await client.query('COMMIT');return {ignored:true,reason:'cancellation_without_local_booking',external_booking_id:externalId};}
    if(!x.check_in||!x.check_out)throw new Error('reservation dates are required');
    const booked=(await client.query(`SELECT COALESCE(SUM(rooms_count),0)::int n FROM hotel_bookings WHERE room_id=$1 AND status IN ('pending','confirmed') AND check_in < $3::date AND check_out > $2::date`,[roomMap.room_id,x.check_in,x.check_out])).rows[0].n;
    const blocked=(await client.query(`SELECT COALESCE(SUM(quantity),0)::int n FROM hotel_availability_blocks WHERE room_id=$1 AND start_date < $3::date AND end_date > $2::date`,[roomMap.room_id,x.check_in,x.check_out])).rows[0].n;
    const room=(await client.query(`SELECT * FROM hotel_rooms WHERE id=$1 FOR UPDATE`,[roomMap.room_id])).rows[0]; const roomsCount=Math.max(1,Number(x.rooms_count)||1); const available=Math.max(0,Number(room?.quantity||0)-Number(booked)-Number(blocked));
    if(!room||available<roomsCount)throw new Error(`overbooking prevented: available ${available}, requested ${roomsCount}`);
    const code='EXT-'+p.slice(0,3).toUpperCase()+'-'+crypto.randomBytes(5).toString('hex').toUpperCase();
    const nights=Math.max(1,Math.ceil((new Date(x.check_out)-new Date(x.check_in))/86400000));
    const local=(await client.query(`INSERT INTO hotel_bookings(booking_code,hotel_id,room_id,guest_name,guest_email,guest_phone,check_in,check_out,adults,children,rooms_count,nights,unit_price,subtotal,total,currency,payment_method,payment_status,status,special_requests) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,0,0,$13,'external','paid',$14,$15) RETURNING id`,[code,roomMap.hotel_id,roomMap.room_id,x.guest_name||'External guest',x.guest_email||null,x.guest_phone||'N/A',x.check_in,x.check_out,Number(x.adults)||1,Number(x.children)||0,roomsCount,nights,x.currency||'USD','confirmed',`External ${p} booking ${externalId}`])).rows[0];
    const er=(await client.query(`INSERT INTO hotel_external_reservations(provider,external_booking_id,hotel_id,room_id,local_booking_id,status,payload) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[p,externalId,roomMap.hotel_id,roomMap.room_id,local.id,status,JSON.stringify(x)])).rows[0];
    await client.query(`INSERT INTO hotel_booking_events(booking_id,event_type,note) VALUES($1,'external_import','Imported from ${p}: ${externalId}')`,[local.id]);
    await client.query('COMMIT'); await refreshAffectedInventory(pool,roomMap.hotel_id,x.check_in,x.check_out); return {created:true,external:er,local_booking_id:local.id,status};
  }catch(e){try{await client.query('ROLLBACK')}catch(_){} throw e}finally{client.release()}
}
async function fetchExternalReservations(pool,provider,hotelId,{sinceMinutes=30}={}){
  const p=String(provider).toLowerCase(); const cfg=providerConfig(p); if(!cfg)throw new Error('provider not supported');
  const externalHotelId=String(hotelId||cfg.hotel||''); if(!externalHotelId)throw new Error(`${p}: external hotel id is required`);
  if(p==='booking'){
    const base=process.env.BOOKING_RESERVATIONS_BASE_URL||'https://secure-supply-xml.booking.com'; const out=[];
    for(const pathName of ['OTA_HotelResNotif','OTA_HotelResModifyNotif']){
      const r=await fetch(`${base}/hotels/ota/${pathName}?hotel_ids=${encodeURIComponent(externalHotelId)}&limit=200`,{headers:{Authorization:`Bearer ${cfg.token}`,Accept:'application/xml','User-Agent':'Aqartkom-ChannelManager/25'}});const text=await r.text();if(!r.ok)throw new Error(`Booking ${r.status}: ${text.slice(0,500)}`);
      const chunks=text.match(/<HotelReservation[\s\S]*?<\/HotelReservation>/gi)||[]; for(const chunk of chunks)out.push(await ingestExternalBooking(pool,'booking',chunk));
      const ids=[...text.matchAll(/<HotelReservationID[^>]*ResID_Value=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
      if(ids.length&&process.env.BOOKING_AUTO_ACK!=='false'){
        const body=`<?xml version="1.0" encoding="UTF-8"?><OTA_${pathName}RS TimeStamp="${new Date().toISOString()}" Target="Production"><${pathName==='OTA_HotelResNotif'?'HotelReservations':'HotelResModifies'}>${ids.map(id=>pathName==='OTA_HotelResNotif'?`<HotelReservation><ResGlobalInfo><HotelReservationIDs><HotelReservationID ResID_Value="${id}"/></HotelReservationIDs></ResGlobalInfo></HotelReservation>`:`<HotelResModify><ResGlobalInfo><HotelReservationIDs><HotelReservationID ResID_Value="${id}"/></HotelReservationIDs></ResGlobalInfo></HotelResModify>`).join('')}</${pathName==='OTA_HotelResNotif'?'HotelReservations':'HotelResModifies'}></OTA_${pathName}RS>`;
        await fetch(`${base}/hotels/ota/${pathName}`,{method:'POST',headers:{Authorization:`Bearer ${cfg.token}`,'Content-Type':'application/xml'},body});
      }
    } return {provider:p,processed:out.length,results:out};
  }
  if(p==='agoda'){
    const key=process.env.AGODA_API_KEY;if(!key)throw new Error('agoda: AGODA_API_KEY is required'); const now=new Date(),from=new Date(now.getTime()-Math.max(5,sinceMinutes)*60000),to=new Date(now.getTime()+60000);const fmt=d=>d.toISOString().replace('Z','+00:00');
    const xml=`<?xml version="1.0" encoding="UTF-8"?><request type="9" timestamp="${Date.now()}"><criteria from="${fmt(from)}" to="${fmt(to)}"><property id="${externalHotelId}"/></criteria></request>`;
    const r=await fetch(`${cfg.base}/api?apiKey=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'text/xml','Accept':'application/xml'},body:xml});const text=await r.text();if(!r.ok)throw new Error(`Agoda ${r.status}: ${text.slice(0,500)}`);
    const chunks=text.match(/<booking\b[\s\S]*?<\/booking>/gi)||[];const out=[];for(const b of chunks){const booking_id=xmlAttrValue(b,['booking'],'booking_id');const property_id=xmlAttrValue(b,['property'],'id')||externalHotelId;const arrival=xmlAttrValue(b,['booking'],'arrival'),departure=xmlAttrValue(b,['booking'],'departure'),status=xmlAttrValue(b,['booking'],'status')||'ConfirmBooking';const room_id=xmlAttrValue(b,['room','booking'],'room_id')||xmlAttrValue(b,['room'],'id');out.push(await ingestExternalBooking(pool,'agoda',{external_id:booking_id,hotel_id:property_id,external_room_id:room_id,check_in:arrival,check_out:departure,status,raw_xml:b}));}return {provider:p,processed:out.length,results:out};
  }
  const url=process.env.EXPEDIA_RESERVATIONS_URL;if(!url)throw new Error('expedia: EXPEDIA_RESERVATIONS_URL must be configured from the approved Connectivity contract');const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${cfg.token}`, 'Content-Type':'application/json','User-Agent':'Aqartkom-ChannelManager/25'},body:JSON.stringify({propertyId:externalHotelId,sinceMinutes})});const data=await r.json();if(!r.ok)throw new Error(`Expedia ${r.status}: ${JSON.stringify(data).slice(0,500)}`);const events=Array.isArray(data.reservations)?data.reservations:Array.isArray(data.events)?data.events:[data];const out=[];for(const e of events)out.push(await ingestExternalBooking(pool,'expedia',e));return {provider:p,processed:out.length,results:out};
}


function normalizeText(v){return String(v||'').toLowerCase().replace(/[\s_\-]+/g,' ').trim();}
function similarity(a,b){a=normalizeText(a);b=normalizeText(b);if(!a||!b)return 0;if(a===b)return 1;const A=new Set(a.split(' ')),B=new Set(b.split(' '));let inter=0;for(const x of A)if(B.has(x))inter++;return inter/Math.max(A.size,B.size);}
function xmlAttr(tag,attr){const m=tag.match(new RegExp(attr+'=["\\\']([^"\\\']*)["\\\']','i'));return m?m[1]:null;}
function discoverBooking(raw,hotelId){
  const out=[];const re=/<RoomType[\s\S]*?RoomTypeCode=["']([^"']+)["'][\s\S]*?<\/RoomType>/gi;let m;
  const blocks=[];while((m=re.exec(raw)))blocks.push(m[0]);
  for(const block of blocks){const roomId=m=block.match(/RoomTypeCode=["']([^"']+)["']/i)?.[1];const roomName=block.match(/RoomTypeName=["']([^"']*)["']/i)?.[1]||block.match(/<RoomDescription[^>]*>\s*<Text[^>]*>([^<]+)/i)?.[1]||'';const rates=[...block.matchAll(/<RatePlan[\s\S]*?RatePlanCode=["']([^"']+)["'][^>]*>/gi)];for(const r of rates)out.push({provider:'booking',external_hotel_id:String(hotelId),external_room_id:r[1]&&roomId?roomId:null,external_rate_plan_id:r[1],room_name:roomName,rate_plan_name:r[0].match(/RatePlanName=["']([^"']*)["']/i)?.[1]||'',raw:{xml:block.slice(0,8000)}})}
  return out;
}
function discoverAgoda(raw,hotelId){
  const out=[];const rooms=[...raw.matchAll(/<room\b([^>]*)>([\s\S]*?)<\/room>/gi)];for(const rm of rooms){const attrs=rm[1],body=rm[2],roomId=xmlAttr(attrs,'room_id')||xmlAttr(attrs,'id');const roomName=xmlAttr(attrs,'name')||body.match(/<name[^>]*>([^<]+)<\/name>/i)?.[1]||'';const rates=[...body.matchAll(/<rateplan\b([^>]*)>/gi)];for(const rr of rates){const ra=rr[1];out.push({provider:'agoda',external_hotel_id:String(hotelId),external_room_id:roomId,external_rate_plan_id:xmlAttr(ra,'rateplan_id')||xmlAttr(ra,'id'),room_name:roomName,rate_plan_name:xmlAttr(ra,'name')||'',raw:{xml:rm[0].slice(0,8000)}})}}return out.filter(x=>x.external_room_id&&x.external_rate_plan_id);
}
function discoverExpedia(raw,hotelId){
  let data=raw;try{data=JSON.parse(raw)}catch(_){};const arr=Array.isArray(data?.rooms)?data.rooms:Array.isArray(data?.units)?data.units:[];return arr.flatMap(r=>{const rates=Array.isArray(r.ratePlans)?r.ratePlans:Array.isArray(r.rateplans)?r.rateplans:[];return rates.map(x=>({provider:'expedia',external_hotel_id:String(hotelId),external_room_id:String(r.id||r.unitId||r.roomId||''),external_rate_plan_id:String(x.id||x.ratePlanId||''),room_name:r.name||r.roomName||'',rate_plan_name:x.name||x.ratePlanName||'',raw:r}))}).filter(x=>x.external_room_id&&x.external_rate_plan_id)}
async function discoverCatalog(pool,hotelId,provider,externalHotelId){
  provider=String(provider).toLowerCase();const c=providerConfig(provider);if(!c?.token)throw new Error(`${provider}: API credentials are not configured`);const hid=String(externalHotelId||c.hotel||'');if(!hid)throw new Error(`${provider}: external hotel/property ID is required`);let raw='';
  if(provider==='booking'){
    const u=`${c.base}/hotels/ota/OTA_HotelProductNotif?HotelCode=${encodeURIComponent(hid)}&IncludeReadOnly=true`;const r=await fetch(u,{headers:{...headers(provider),'Accept':'application/xml','Accept-Version':'1.2'}});raw=await r.text();if(!r.ok)throw new Error(`Booking ${r.status}: ${raw.slice(0,500)}`);
  } else if(provider==='agoda'){
    const key=process.env.AGODA_API_KEY||c.token;const xml=`<?xml version="1.0" encoding="UTF-8"?><request type="5" timestamp="${Date.now()}"><criteria property_id="${hid}"/></request>`;const r=await fetch(`${c.base}/api?apiKey=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'text/xml','Accept':'text/xml','User-Agent':'Aqartkom-ChannelManager/23'},body:xml});raw=await r.text();if(!r.ok)throw new Error(`Agoda ${r.status}: ${raw.slice(0,500)}`);
  } else {
    const url=process.env.EXPEDIA_CATALOG_URL;if(!url)throw new Error('expedia: set EXPEDIA_CATALOG_URL to the catalog endpoint supplied by Expedia Connectivity');const r=await fetch(url.replace('{hotelId}',encodeURIComponent(hid)),{headers:headers(provider)});raw=await r.text();if(!r.ok)throw new Error(`Expedia ${r.status}: ${raw.slice(0,500)}`);
  }
  const rows=provider==='booking'?discoverBooking(raw,hid):provider==='agoda'?discoverAgoda(raw,hid):discoverExpedia(raw,hid);await pool.query(`DELETE FROM hotel_channel_catalog WHERE hotel_id=$1 AND provider=$2`,[hotelId,provider]);for(const x of rows)await pool.query(`INSERT INTO hotel_channel_catalog(hotel_id,provider,external_hotel_id,external_room_id,external_rate_plan_id,room_name,rate_plan_name,raw_payload,discovered_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) ON CONFLICT(provider,external_hotel_id,external_room_id,external_rate_plan_id) DO UPDATE SET hotel_id=EXCLUDED.hotel_id,room_name=EXCLUDED.room_name,rate_plan_name=EXCLUDED.rate_plan_name,raw_payload=EXCLUDED.raw_payload,updated_at=NOW()`,[hotelId,x.provider,x.external_hotel_id,x.external_room_id,x.external_rate_plan_id,x.room_name,x.rate_plan_name,JSON.stringify(x.raw||{})]);return rows;
}
async function getMappingSuggestions(pool,hotelId,provider){const locals=(await pool.query(`SELECT id,name,room_type,max_guests FROM hotel_rooms WHERE hotel_id=$1 AND status='active' ORDER BY id`,[hotelId])).rows;const cats=(await pool.query(`SELECT * FROM hotel_channel_catalog WHERE hotel_id=$1 AND provider=$2 ORDER BY external_room_id,external_rate_plan_id`,[hotelId,provider])).rows;const maps=(await pool.query(`SELECT * FROM hotel_channel_mappings WHERE hotel_id=$1 AND provider=$2 AND is_active=TRUE`,[hotelId,provider])).rows;return cats.map(c=>{const best=locals.map(r=>({r,score:Math.max(similarity(r.name,c.room_name),similarity(r.room_type,c.room_name))})).sort((a,b)=>b.score-a.score)[0];const already=maps.find(m=>m.external_room_id===c.external_room_id&&m.external_rate_plan_id===c.external_rate_plan_id);return {...c,suggested_room_id:best?.r.id||null,suggested_room_name:best?.r.name||null,confidence:Math.round((best?.score||0)*100),mapped:!!already,mapping_id:already?.id||null};});}
async function testConnection(pool,hotelId,provider,externalHotelId){
  provider=String(provider).toLowerCase(); const c=providerConfig(provider); if(!c?.token) throw new Error(`${provider}: API credentials are not configured`);
  const hid=String(externalHotelId||c.hotel||''); if(!hid) throw new Error(`${provider}: external hotel/property ID is required`);
  let raw='';
  if(provider==='booking'){
    const u=`${c.base}/hotels/ota/OTA_HotelProductNotif?HotelCode=${encodeURIComponent(hid)}&IncludeReadOnly=true`;
    const r=await fetch(u,{headers:{...headers(provider),'Accept':'application/xml','Accept-Version':'1.2'}}); raw=await r.text(); if(!r.ok) throw new Error(`Booking ${r.status}: ${raw.slice(0,500)}`);
  } else if(provider==='agoda'){
    const key=process.env.AGODA_API_KEY||c.token; const xml=`<?xml version="1.0" encoding="UTF-8"?><request type="5" timestamp="${Date.now()}"><criteria property_id="${hid}"/></request>`;
    const r=await fetch(`${c.base}/api?apiKey=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'text/xml','Accept':'text/xml','User-Agent':'Aqartkom-ChannelManager/24'},body:xml}); raw=await r.text(); if(!r.ok) throw new Error(`Agoda ${r.status}: ${raw.slice(0,500)}`);
  } else {
    const url=process.env.EXPEDIA_CATALOG_URL; if(!url) throw new Error('expedia: EXPEDIA_CATALOG_URL must be configured from your Expedia Connectivity contract');
    const r=await fetch(url.replace('{hotelId}',encodeURIComponent(hid)),{headers:headers(provider)}); raw=await r.text(); if(!r.ok) throw new Error(`Expedia ${r.status}: ${raw.slice(0,500)}`);
  }
  return {ok:true,provider,external_hotel_id:hid,raw:raw.slice(0,2000)};
}

function isoDate(d){return d.toISOString().slice(0,10)}
async function buildDailyInventory(pool,hotelId,from,to){
  const rooms=(await pool.query(`SELECT * FROM hotel_rooms WHERE hotel_id=$1 AND status='active' ORDER BY id`,[hotelId])).rows;
  const dates=[]; for(let d=new Date(from+'T00:00:00Z'), e=new Date(to+'T00:00:00Z'); d<e; d.setUTCDate(d.getUTCDate()+1)) dates.push(isoDate(d));
  const out=[];
  for(const room of rooms){
    const booked=(await pool.query(`SELECT check_in,check_out,rooms_count FROM hotel_bookings WHERE room_id=$1 AND status IN ('pending','confirmed') AND check_in < $3::date AND check_out > $2::date`,[room.id,from,to])).rows;
    const blocked=(await pool.query(`SELECT start_date,end_date,quantity FROM hotel_availability_blocks WHERE room_id=$1 AND start_date < $3::date AND end_date > $2::date`,[room.id,from,to])).rows;
    const rates=(await pool.query(`SELECT start_date,end_date,price,currency FROM hotel_room_rates WHERE room_id=$1 AND end_date > $2::date AND start_date < $3::date ORDER BY start_date,created_at`,[room.id,from,to])).rows;
    for(const day of dates){
      let b=0,bl=0; for(const x of booked) if(x.check_in<=day && x.check_out>day) b+=Number(x.rooms_count||0); for(const x of blocked) if(x.start_date<=day && x.end_date>day) bl+=Number(x.quantity||0);
      const rr=[...rates].reverse().find(x=>x.start_date<=day && x.end_date>day)||room; out.push({room,day,inventory:Math.max(0,Number(room.quantity)-b-bl),price:Number(rr.price),currency:rr.currency||room.currency||'USD'});
    }
  }
  return out;
}
async function syncInitial365(pool,hotelId,provider,{from,to,onProgress}={}){
  provider=String(provider).toLowerCase(); const start=from||isoDate(new Date()); const end=to||isoDate(new Date(Date.now()+365*86400000));
  const maps=(await pool.query(`SELECT * FROM hotel_channel_mappings WHERE hotel_id=$1 AND provider=$2 AND is_active=TRUE ORDER BY id`,[hotelId,provider])).rows;
  if(!maps.length) throw new Error(`${provider}: لا توجد مطابقة فعالة`);
  const daily=await buildDailyInventory(pool,hotelId,start,end); const byRoom=new Map(daily.map(x=>[x.room.id,x]));
  let total=maps.length, done=0, failed=0; const results=[];
  for(const m of maps){
    const rows=daily.filter(x=>x.room.id===m.room_id); let i=0;
    while(i<rows.length){
      let j=i+1; while(j<rows.length && rows[j].inventory===rows[i].inventory && rows[j].price===rows[i].price && rows[j].currency===rows[i].currency) j++;
      const a=rows[i], z=rows[j-1]; try{await pushInventory(pool,{...m,currency:a.currency},a.day,isoDate(new Date(new Date(z.day+'T00:00:00Z').getTime()+86400000)),a.price,a.inventory); results.push({mapping_id:m.id,from:a.day,to:z.day,status:'success'});}catch(e){failed++;results.push({mapping_id:m.id,from:a.day,to:z.day,status:'error',error:e.message});}
      i=j;
    }
    done++; if(onProgress) await onProgress(done,total,results[results.length-1]);
    await pool.query(`UPDATE hotel_channel_mappings SET last_synced_at=NOW(),last_error=$1 WHERE id=$2`,[results.filter(x=>x.mapping_id===m.id&&x.status==='error').slice(-1)[0]?.error||null,m.id]);
  }
  return {provider,start,end,total,completed:done,failed,results};
}

module.exports={syncHotel,ingestExternalBooking,pushInventory,discoverCatalog,getMappingSuggestions,testConnection,syncInitial365,fetchExternalReservations,refreshAffectedInventory};
