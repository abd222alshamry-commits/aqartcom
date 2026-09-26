'use strict';
const {priceStay}=require('./stay-inventory');
const policy=require('./stay-policy');
const TYPES=['hotel','chalet','farm','furnished_apartment'];
const error=(status,message)=>Object.assign(new Error(message),{status});
const send=(res,e)=>{if(!e.status)console.error('Stay experience:',e.message);res.status(e.status||500).json({error:e.status?e.message:'تعذر إكمال الطلب الآن. أعد المحاولة.'});};
const publicHotel=h=>Object.fromEntries(['id','name','slug','city','district','address','description','lodging_type','star_rating','amenities','images','videos','cover_media','check_in_time','check_out_time','free_cancel_hours','cancellation_policy','rental_terms','review_score','review_count','latitude','longitude'].map(k=>[k,h[k]]));
async function batches(rows,fn){const out=[];for(let i=0;i<rows.length;i+=5)out.push(...await Promise.all(rows.slice(i,i+5).map(fn)));return out;}
const selection=(q,stay)=>stay({hotel_id:1,room_id:1,check_in:q.checkIn||q.check_in,check_out:q.checkOut||q.check_out,adults:q.adults||2,children:q.children||0,rooms_count:q.rooms||q.rooms_count||1});
function searchHandler(pool,stay){return async(req,res)=>{try{
  res.set('Cache-Control','no-store');const s=selection(req.query,stay),vals=[],where=["h.status='active'"];
  const add=(value,sql)=>{vals.push(value);where.push(sql.replaceAll('?', '$'+vals.length));};
  if(req.query.includeDemo!=='true')where.push("NOT (h.slug LIKE 'aqartkom-demo-hotel-v1-%' AND h.name LIKE 'تجريبي —%')");
  if(req.query.region==='mashta')add('%مشتى الحلو%',"(h.city ILIKE ? OR COALESCE(h.district,'') ILIKE ?)");
  else if(req.query.region)throw error(400,'المنطقة غير صحيحة');
  if(req.query.city)add(String(req.query.city).slice(0,100),'h.city=?');
  if(req.query.q)add('%'+String(req.query.q).trim().slice(0,180)+'%',"(h.name ILIKE ? OR h.city ILIKE ? OR COALESCE(h.district,'') ILIKE ?)");
  if(req.query.lodging_type){if(!TYPES.includes(req.query.lodging_type))throw error(400,'نوع المنشأة غير صحيح');add(req.query.lodging_type,'h.lodging_type=?');}
  const currency=String(req.query.currency||'');if(currency&&!['USD','SYP','EUR','SAR'].includes(currency))throw error(400,'العملة غير مدعومة');
  const hs=(await pool.query(`SELECT h.*,(SELECT AVG(r.rating) FROM hotel_reviews r WHERE r.hotel_id=h.id AND r.status='published') review_score,(SELECT COUNT(*)::int FROM hotel_reviews r WHERE r.hotel_id=h.id AND r.status='published') review_count FROM hotels h WHERE ${where.join(' AND ')} ORDER BY h.created_at DESC LIMIT 100`,vals)).rows;
  if(!hs.length)return res.json({data:[],nights:s.nights});
  const rooms=(await pool.query("SELECT * FROM hotel_rooms WHERE hotel_id=ANY($1::bigint[]) AND status='active' AND max_guests>=$2 ORDER BY id",[hs.map(h=>h.id),s.adults+(s.children||0)])).rows;
  const indexed=new Map(hs.map(h=>[String(h.id),h]));
  const priced=await batches(rooms,async room=>{try{const h=indexed.get(String(room.hotel_id)),p=await priceStay(pool,h,room,{...s,hotelId:h.id,roomId:room.id});return currency&&p.currency!==currency?null:{hotelId:h.id,roomId:room.id,...p};}catch(e){if(e.status===409)return null;throw e;}});
  let data=hs.map(h=>{
   const offers=priced.filter(p=>p&&String(p.hotelId)===String(h.id));if(!offers.length)return null;
   // Choose one actual offer; never add or compare amounts in different currencies.
   const preferred=offers.find(p=>p.currency==='USD')?.currency||offers[0].currency;
   const best=offers.filter(p=>p.currency===preferred).sort((a,b)=>a.total-b.total)[0];
   return {...publicHotel(h),min_price:best.unit_price,currency:best.currency,from_total:best.total,subtotal:best.subtotal,discount_amount:best.discount_amount,nights:s.nights,rooms_count:s.rooms,available_room_types:offers.length,from_room_id:best.roomId};
  }).filter(Boolean);
  if(req.query.maxTotal){const max=Number(req.query.maxTotal);if(!currency||!Number.isFinite(max)||max<0)throw error(400,'حدد عملة وميزانية صحيحة');data=data.filter(h=>h.from_total<=max);}
  if(req.query.minRating)data=data.filter(h=>Number(h.review_score)>=Number(req.query.minRating));
  const amenities=String(req.query.amenities||'').split(',').filter(Boolean);if(amenities.length)data=data.filter(h=>amenities.every(a=>JSON.stringify(h.amenities||[]).toLowerCase().includes(a.toLowerCase())));
  if(req.query.sort==='price'){if(!currency)throw error(400,'اختر عملة لترتيب الأسعار');data.sort((a,b)=>a.from_total-b.from_total);}
  else if(req.query.sort==='rating')data.sort((a,b)=>Number(b.review_score||0)-Number(a.review_score||0)||Number(b.review_count)-Number(a.review_count));
  res.json({data,nights:s.nights,pricing:'per_night',currency:currency||null});
 }catch(e){send(res,e);}};}
function register(app,{pool,getCurrentUser,syncHotel,stay,receipt}){
 app.get('/api/stays/search',searchHandler(pool,stay));
 app.get('/api/stays/:id/availability',async(req,res)=>{try{
  res.set('Cache-Control','no-store');const base=selection(req.query,stay);
  const h=(await pool.query("SELECT * FROM hotels WHERE id=$1 AND status='active'",[req.params.id])).rows[0];if(!h)throw error(404,'المنشأة غير متاحة');
  const rooms=(await pool.query("SELECT * FROM hotel_rooms WHERE hotel_id=$1 AND status='active' ORDER BY price,id",[h.id])).rows;
  const result=await batches(rooms,async room=>{try{const p=await priceStay(pool,h,room,{...base,hotelId:h.id,roomId:room.id});return {...room,available:true,quote:{...p,nights:base.nights,rooms_count:base.rooms}};}catch(e){if(e.status!==409)throw e;return {...room,available:false,unavailable_reason:e.message};}});
  res.json({data:result,hotel:publicHotel(h),stay_terms:policy.snapshot(h)});
 }catch(e){send(res,e);}});
 const bookingSelect=`SELECT b.*,h.name hotel_name,h.city hotel_city,h.district hotel_district,r.name room_name FROM hotel_bookings b JOIN hotels h ON h.id=b.hotel_id JOIN hotel_rooms r ON r.id=b.room_id`;
 const present=b=>({...receipt(b,b.hotel_name,b.room_name),hotel_city:b.hotel_city,hotel_district:b.hotel_district,can_cancel:['pending','confirmed'].includes(b.status)&&!!b.cancellation_deadline&&Date.now()<=new Date(b.cancellation_deadline).getTime(),refund_eligible:b.payment_status==='paid'});
 app.get('/api/stays/bookings',async(req,res)=>{try{res.set('Cache-Control','no-store');const user=await getCurrentUser(req);if(!user)return res.json({data:[],signed_in:false});res.json({data:(await pool.query(bookingSelect+' WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT 50',[user.id])).rows.map(present),signed_in:true});}catch(e){send(res,e);}});
 app.get('/api/stays/booking/:code',async(req,res)=>{try{res.set('Cache-Control','no-store');if(!/^AQH-[A-Z0-9]{6,36}$/.test(req.params.code))throw error(404,'الحجز غير موجود');const b=(await pool.query(bookingSelect+' WHERE b.booking_code=$1',[req.params.code])).rows[0];if(!b)throw error(404,'الحجز غير موجود');res.json({data:present(b)});}catch(e){send(res,e);}});
 app.post('/api/stays/booking/:code/cancel',async(req,res)=>{
  let client,transaction=false;
  try{
   client=await pool.connect();await client.query('BEGIN');transaction=true;
   const b=(await client.query(bookingSelect+' WHERE b.booking_code=$1 FOR UPDATE OF b',[req.params.code])).rows[0];if(!b)throw error(404,'الحجز غير موجود');
   if(b.status==='cancelled'){await client.query('COMMIT');transaction=false;return res.json({data:present(b),repeated:true});}
   if(!present(b).can_cancel)throw error(409,'لا يمكن الإلغاء المجاني الآن؛ انتهت المهلة أو لم يعد الحجز قابلًا للإلغاء');
   const reason=String(req.body?.reason||'إلغاء من الضيف').trim().slice(0,500);
   const updated=(await client.query("UPDATE hotel_bookings SET status='cancelled',cancelled_at=NOW(),cancellation_reason=$1,updated_at=NOW() WHERE id=$2 RETURNING *",[reason,b.id])).rows[0];
   await client.query("INSERT INTO hotel_booking_events(booking_id,event_type,note) VALUES($1,'cancelled',$2)",[b.id,reason]);await client.query('COMMIT');transaction=false;
   res.json({data:present({...b,...updated})});Promise.resolve().then(()=>syncHotel(pool,b.hotel_id)).catch(e=>console.error('Stay cancellation sync:',e.message));
  }catch(e){if(transaction)await client.query('ROLLBACK').catch(()=>{});send(res,e);}finally{client?.release();}
 });
}
module.exports={register,searchHandler};
