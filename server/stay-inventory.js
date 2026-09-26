'use strict';
const fail=message=>Object.assign(new Error(message),{status:409});
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Damascus',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
// One calculation for every night is shared by search, room selection and confirmation.
async function priceStay(db,hotel,room,s){
 if(Number(room.max_guests)<s.adults+(s.children||0))throw fail('عدد الضيوف والأطفال لكل وحدة يتجاوز سعتها');
 const days=(await db.query(`SELECT to_char(d::date,'YYYY-MM-DD') stay_date,
  $4::int-COALESCE((SELECT SUM(b.rooms_count) FROM hotel_bookings b WHERE b.room_id=$1 AND b.status IN ('pending','confirmed') AND b.check_in<=d::date AND b.check_out>d::date),0)
  -COALESCE((SELECT SUM(b.quantity) FROM hotel_availability_blocks b WHERE b.room_id=$1 AND b.start_date<=d::date AND b.end_date>d::date),0) available,
  COALESCE(rate.price,$5::numeric) price,COALESCE(rate.currency,$6::text) currency,COALESCE(rate.min_nights,1) min_nights,
  COALESCE((SELECT MAX(p.discount_percent) FROM hotel_promotions p WHERE p.hotel_id=$7 AND p.active=TRUE AND p.start_date<=d::date AND p.end_date>d::date),0) discount
 FROM generate_series($2::date,$3::date-1,interval '1 day') d
 LEFT JOIN LATERAL(SELECT price,currency,min_nights FROM hotel_room_rates WHERE room_id=$1 AND start_date<=d::date AND end_date>d::date ORDER BY created_at DESC,id DESC LIMIT 1) rate ON TRUE
 ORDER BY d`,[s.roomId,s.checkIn,s.checkOut,room.quantity,room.price,room.currency,s.hotelId])).rows;
 if(days.length!==s.nights)throw fail('تعذر حساب جميع ليالي الإقامة');
 const available=Math.max(0,Math.min(...days.map(d=>Number(d.available))));
 if(available<s.rooms)throw fail(`لا يوجد توفر كافٍ لهذه الفترة. المتاح: ${available}`);
 const minimum=Math.max(...days.map(d=>Number(d.min_nights)));
 if(s.nights<minimum)throw fail(`الحد الأدنى للإقامة لهذه التواريخ ${minimum} ليالٍ`);
 const currencies=new Set(days.map(d=>d.currency));if(currencies.size!==1)throw fail('تختلف عملة الأسعار بين ليالي الإقامة. يرجى اختيار فترة أخرى أو مراجعة المنشأة');
 let subtotal=0,total=0;
 const nightly=days.map(d=>{
  const cents=Math.round(Number(d.price)*100),discount=Number(d.discount),before=cents*s.rooms,after=Math.round(before*(1-discount/100));
  if(!Number.isSafeInteger(before)||before<0||!Number.isFinite(discount)||discount<0||discount>100)throw fail('تعذر التحقق من سعر الوحدة');
  subtotal+=before;total+=after;
  return {date:d.stay_date,unit_price:cents/100,rooms_count:s.rooms,subtotal:before/100,discount_percent:discount,total:after/100};
 });
 if(!Number.isSafeInteger(total)||!Number.isSafeInteger(subtotal))throw fail('إجمالي السعر يتجاوز الحد المسموح');
 return {subtotal:subtotal/100,total:total/100,discount:subtotal?Number(((subtotal-total)*100/subtotal).toFixed(2)):0,discount_amount:(subtotal-total)/100,unit_price:Number((subtotal/100/s.nights/s.rooms).toFixed(2)),currency:days[0].currency,available,nightly,service_fee:0};
}
module.exports={today,priceStay};
