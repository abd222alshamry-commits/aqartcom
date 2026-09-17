'use strict';
const crypto = require('node:crypto');
const stayPolicy=require('./stay-policy');
const DAY = 86400000;
class HotelError extends Error { constructor(status, message) { super(message); this.status = status; } }
function stay(input, today = new Date().toISOString().slice(0, 10)) {
  const checkIn = String(input.check_in || ''), checkOut = String(input.check_out || '');
  function parse(s) { const ms = Date.parse(s + 'T00:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s ? ms : NaN; }
  const nights = (parse(checkOut) - parse(checkIn)) / DAY;
  const hotelId = Number(input.hotel_id), roomId = Number(input.room_id), adults = Number(input.adults), rooms = Number(input.rooms_count);
  if (!Number.isInteger(nights) || nights < 1 || nights > 365 || checkIn < today) throw new HotelError(400, 'اختر تاريخ وصول صالحًا ومغادرة بعده، لمدة لا تتجاوز سنة');
  if (![hotelId, roomId, adults, rooms].every(n => Number.isSafeInteger(n) && n > 0) || adults > 20 || rooms > 20) throw new HotelError(400, 'بيانات الفندق أو الغرفة أو أعداد الضيوف غير صحيحة');
  return { hotelId, roomId, adults, rooms, checkIn, checkOut, nights };
}
function totalFor(price, nights, rooms, discount) {
  const value = Number(price), reduction = Number(discount);
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(reduction) || reduction < 0 || reduction > 100) throw new HotelError(409, 'تعذر التحقق من سعر الغرفة');
  const subtotal = Number((value * nights * rooms).toFixed(2));
  return { subtotal, total: Number((subtotal * (1 - reduction / 100)).toFixed(2)), discount: reduction };
}
function guest(input) {
  const result = { name: String(input.guest_name || '').trim(), phone: String(input.guest_phone || '').trim(), email: String(input.guest_email || '').trim(), requests: String(input.special_requests || '').trim() };
  if (result.name.length < 2 || result.name.length > 180 || !/^[+\d\s()\-٠-٩]{7,80}$/.test(result.phone) || result.email.length > 220 || (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) || result.requests.length > 2000) throw new HotelError(400, 'راجع اسم الضيف ورقم الهاتف والبريد الإلكتروني');
  return result;
}
function requestHash(s, g, expected, currency, method='pay_at_hotel', payment=null) { const parts=[s,g,expected,currency,method]; if(payment)parts.push(payment); return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex'); }
async function quote(db, s, lock = false) {
  const hotel = (await db.query("SELECT * FROM hotels WHERE id=$1 AND status='active'" + (lock ? ' FOR SHARE' : ''), [s.hotelId])).rows[0];
  const room = (await db.query("SELECT * FROM hotel_rooms WHERE id=$1 AND hotel_id=$2 AND status='active'" + (lock ? ' FOR UPDATE' : ''), [s.roomId, s.hotelId])).rows[0];
  if (!hotel || !room) throw new HotelError(404, 'الفندق أو الغرفة غير متاح');
  if (Number(room.max_guests) < s.adults) throw new HotelError(409, 'عدد الضيوف لكل غرفة يتجاوز سعتها');
  // Count occupied rooms for each night, not the sum of non-overlapping bookings.
  const availability = (await db.query(`SELECT MIN($4::int
    - COALESCE((SELECT SUM(rooms_count) FROM hotel_bookings WHERE room_id=$1 AND status IN ('pending','confirmed') AND check_in<=d::date AND check_out>d::date),0)
    - COALESCE((SELECT SUM(quantity) FROM hotel_availability_blocks WHERE room_id=$1 AND start_date<=d::date AND end_date>d::date),0))::int available
    FROM generate_series($2::date, $3::date - 1, interval '1 day') d`, [s.roomId, s.checkIn, s.checkOut, room.quantity])).rows[0];
  const available = Math.max(0, Number(availability.available));
  if (available < s.rooms) throw new HotelError(409, `لا يوجد توفر كافٍ لهذه الفترة. المتاح: ${available}`);
  const rate = (await db.query('SELECT price,currency,min_nights FROM hotel_room_rates WHERE room_id=$1 AND start_date<=$2 AND end_date>$2 ORDER BY created_at DESC LIMIT 1', [s.roomId, s.checkIn])).rows[0] || room;
  if (s.nights < Number(rate.min_nights || 1)) throw new HotelError(409, `الحد الأدنى للإقامة في هذا العرض ${rate.min_nights} ليالٍ`);
  const discount = (await db.query('SELECT COALESCE(MAX(discount_percent),0) discount FROM hotel_promotions WHERE hotel_id=$1 AND active=TRUE AND start_date<=$2 AND end_date>=$3', [s.hotelId, s.checkIn, s.checkOut])).rows[0].discount;
  const price = totalFor(rate.price, s.nights, s.rooms, discount);
  return { hotel, room, public: { ...price, unit_price: Number(rate.price), currency: rate.currency, nights: s.nights, rooms_count: s.rooms, adults: s.adults, check_in: s.checkIn, check_out: s.checkOut, available, hotel_id: s.hotelId, room_id: s.roomId, hotel_name: hotel.name, room_name: room.name, payment_method: 'pay_at_hotel', cancellation_policy: stayPolicy.description(hotel), stay_terms:stayPolicy.snapshot(hotel), terms_version:Number(hotel.terms_version||1), booking_api: 1 } };
}
function sendError(res, error) { if (!error.status) console.error('Mobile hotel request failed:', error.message); return res.status(error.status || 500).json({ error: error.status ? error.message : 'تعذر إكمال طلب الفندق' }); }
function receipt(row, hotelName, roomName) {
  const keys = ['booking_code', 'hotel_id', 'room_id', 'check_in', 'check_out', 'nights', 'rooms_count', 'adults', 'total', 'currency', 'status', 'payment_method', 'payment_status', 'cancellation_deadline','stay_terms_snapshot'];
  return { ...Object.fromEntries(keys.map(key => [key, row[key]])), hotel_name: hotelName, room_name: roomName };
}
function register(app, { pool, getCurrentUser, syncHotel, manualPayments }) {
  app.get('/api/mobile/hotels/quote', async (req, res) => {
    try { res.set('Cache-Control', 'no-store'); const q=await quote(pool,stay(req.query)); const payment_methods=manualPayments?await manualPayments.options(pool,q):[{id:'pay_at_hotel',name:'الدفع عند الوصول',available:true}]; res.json({data:{...q.public,payment_methods}}); }
    catch (e) { sendError(res, e); }
  });
  app.post('/api/mobile/hotels/book', async (req, res) => {
    let client, inTransaction = false;
    try {
      const b = req.body || {}, s = stay(b, '0001-01-01'), g = guest(b), key = String(b.idempotency_key || '');
      const expected = Number(b.expected_total), currency = String(b.expected_currency || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) || b.expected_total == null || !Number.isFinite(expected) || expected < 0 || !/^[A-Z]{3}$/.test(currency)) throw new HotelError(400, 'راجع عرض السعر قبل تأكيد الحجز');
      const method=b.payment_method;
      if (method!=='pay_at_hotel' && !(method==='shamcash_manual' && manualPayments)) throw new HotelError(400,'طريقة الدفع غير متاحة');
      let fingerprint=requestHash(s,g,expected,currency,method,method==='shamcash_manual'?[b.payment_access_token,b.payment_settings_version,b.expected_transfer_amount,b.expected_transfer_currency]:null);
      if(b.expected_terms_version!=null)fingerprint=crypto.createHash('sha256').update(fingerprint+':terms:'+String(b.expected_terms_version)).digest('hex');
      client = await pool.connect(); await client.query('BEGIN'); inTransaction = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext('hotel-request:' || $1))", [key]);
      const previous = (await client.query('SELECT * FROM hotel_bookings WHERE idempotency_key=$1', [key])).rows[0];
      if (previous) {
        if (previous.request_hash !== fingerprint) throw new HotelError(409, 'طلب الحجز السابق يحمل بيانات مختلفة');
        const names = (await client.query('SELECT h.name hotel_name,r.name room_name FROM hotels h JOIN hotel_rooms r ON r.hotel_id=h.id WHERE h.id=$1 AND r.id=$2', [s.hotelId, s.roomId])).rows[0];
        const manual_payment=method==='shamcash_manual'?await manualPayments.resume(client,previous,b.payment_access_token):undefined;
        await client.query('COMMIT'); inTransaction = false;
        return res.json({ data: receipt(previous,names.hotel_name,names.room_name), manual_payment, repeated:true });
      }
      if (s.checkIn < new Date().toISOString().slice(0,10)) throw new HotelError(400, 'تاريخ الوصول أصبح في الماضي؛ اختر تواريخ جديدة');
      // Shares the same room lock used by the website booking endpoint.
      await client.query('SELECT pg_advisory_xact_lock($1)', [s.roomId]);
      const q = await quote(client, s, true);
      if (q.public.currency !== currency || Math.abs(q.public.total - expected) > 0.001) throw new HotelError(409, 'تغير السعر. راجع عرض السعر الجديد قبل التأكيد');
      if(b.expected_terms_version!=null && Number(b.expected_terms_version)!==q.public.terms_version)throw new HotelError(409,'تغيرت شروط الإقامة؛ راجعها قبل تأكيد الحجز');
      const prepared=method==='shamcash_manual'?await manualPayments.prepare(client,q,b):null;
      const user = await getCurrentUser(req);
      const code = 'AQH-' + crypto.randomBytes(9).toString('hex').toUpperCase();
      const commission = Number((q.public.total * Number(q.hotel.platform_commission_rate || 0) / 100).toFixed(2));
      const result = await client.query(`INSERT INTO hotel_bookings
        (booking_code,hotel_id,room_id,user_id,guest_name,guest_email,guest_phone,check_in,check_out,adults,children,rooms_count,nights,unit_price,subtotal,total,currency,payment_method,payment_status,status,cancellation_deadline,special_requests,commission_amount,net_amount,idempotency_key,request_hash,stay_terms_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,$14,$15,$16,$22,'pending',$23,(($8::date+$24::time) AT TIME ZONE 'Asia/Damascus')-($25::int*INTERVAL '1 hour'),$17,$18,$19,$20,$21,$26::jsonb) RETURNING *`,
        [code,s.hotelId,s.roomId,user?.id || null,g.name,g.email || null,g.phone,s.checkIn,s.checkOut,s.adults,s.rooms,s.nights,q.public.unit_price,q.public.subtotal,q.public.total,currency,g.requests || null,commission,Number((q.public.total - commission).toFixed(2)),key,fingerprint,method,prepared?'pending':'confirmed',stayPolicy.snapshot(q.hotel).check_in_time,stayPolicy.snapshot(q.hotel).free_cancel_hours,JSON.stringify(stayPolicy.snapshot(q.hotel))]);
      const booking=result.rows[0];
      const manual_payment=prepared?await manualPayments.create(client,booking,prepared):undefined;
      await client.query("INSERT INTO hotel_booking_events(booking_id,event_type,note,actor_user_id) VALUES($1,'created','تم إنشاء الحجز من التطبيق',$2)", [booking.id,user?.id || null]);
      await client.query('INSERT INTO hotel_invoices(booking_id,invoice_number,gross_amount,commission_amount,net_amount,currency) VALUES($1,$2,$3,$4,$5,$6)', [booking.id,'AQHINV-' + crypto.randomBytes(10).toString('hex').toUpperCase(),q.public.total,commission,booking.net_amount,currency]);
      await client.query('COMMIT'); inTransaction = false;
      res.status(201).json({data:receipt(booking,q.hotel.name,q.room.name),manual_payment});
      Promise.resolve().then(() => syncHotel(pool,s.hotelId)).catch(e => console.error('OTA mobile booking sync:',e.message));
    } catch (e) { if (inTransaction) await client.query('ROLLBACK').catch(() => {}); sendError(res,e); }
    finally { client?.release(); }
  });
}
module.exports = { register, stay, totalFor, guest, quote, requestHash, HotelError };
