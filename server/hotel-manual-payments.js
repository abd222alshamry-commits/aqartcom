'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
class ManualPaymentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const validToken = value => /^[a-f0-9]{64}$/.test(value || '');
const isDemo = hotel => String(hotel.slug || '').startsWith('aqartkom-demo-hotel-v1-');
const qrPath = value => /^\/uploads\/\d+-[a-f0-9]{16}\.(png|jpe?g|webp)$/.test(value || '');
const money = value => Number(Number(value).toFixed(2));
function fail(status, message) { throw new ManualPaymentError(status, message); }
function sendError(res, e) {
  if (e.code === '23505') return res.status(409).json({error:'رقم التحويل مستخدم في طلب آخر.'});
  if (!e.status) console.error('Manual hotel payment:', e.message);
  return res.status(e.status || 500).json({error:e.status ? e.message : 'تعذر إكمال إجراء الدفع. حاول مجددًا.'});
}
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  const expected = new URL(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).origin;
  if (origin && origin !== expected) return res.status(403).json({error:'مصدر الطلب غير مسموح.'});
  next();
}
async function settings(db, lock=false) {
  return (await db.query('SELECT * FROM manual_shamcash_settings WHERE id=1' + (lock ? ' FOR SHARE' : ''))).rows[0];
}
function option(config, quote, hotel) {
  const result = {id:'shamcash_manual',name:'تحويل عبر شام كاش',available:false,reason:'بانتظار إعداد حساب الاستلام من الإدارة'};
  if (isDemo(hotel)) return {...result,reason:'إعلان تجريبي — لا تُحوَّل مبالغ مالية لهذا الحجز'};
  if (!config?.enabled || !config.recipient_label || (!config.recipient && !config.qr_url)) return result;
  let amount=Number(quote.total), rate=null;
  if (quote.currency !== config.currency) {
    if (quote.currency !== 'USD' || config.currency !== 'SYP' || !(Number(config.usd_to_syp_rate)>0)) return {...result,reason:'عملة التحويل أو سعر الصرف لهذا الحجز لم تُضبط بعد'};
    rate=Number(config.usd_to_syp_rate); amount=money(amount*rate);
  }
  if (!Number.isFinite(amount) || amount<=0 || amount>=1e14) return {...result,reason:'لا يوجد مبلغ صالح للتحويل لهذا الحجز'};
  return {...result,available:true,reason:'إرسال رقم التحويل ثم تأكيد الاستلام من الإدارة',amount:money(amount),currency:config.currency,exchange_rate:rate,settings_version:config.version};
}
function createService(pool) {
  return {
    async options(db, q, lock=false) { return [{id:'pay_at_hotel',name:'الدفع عند الوصول',available:true},option(await settings(db,lock),q.public,q.hotel)]; },
    async prepare(db, q, input) {
      const config=await settings(db,true), selected=option(config,q.public,q.hotel);
      if (!selected.available) fail(409,selected.reason);
      if (!validToken(input.payment_access_token)) fail(400,'تعذر إنشاء رابط متابعة آمن. أعد فتح الحجز.');
      if (Number(input.payment_settings_version)!==selected.settings_version || Number(input.expected_transfer_amount)!==selected.amount || input.expected_transfer_currency!==selected.currency) fail(409,'تغيرت بيانات التحويل أو المبلغ. راجع عرض السعر مجددًا.');
      return {config,selected,token:input.payment_access_token};
    },
    async create(db, booking, prepared) {
      const {config,selected,token}=prepared;
      await db.query(`INSERT INTO hotel_manual_payments(booking_id,access_token_hash,amount,currency,recipient,recipient_label,qr_url,settings_version,exchange_rate) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[booking.id,hash(token),selected.amount,selected.currency,config.recipient,config.recipient_label,config.qr_url,config.version,selected.exchange_rate]);
      return {checkout_url:'/hotel-payment.html#'+booking.booking_code+':'+token,status:'awaiting_transfer',amount:selected.amount,currency:selected.currency};
    },
    async resume(db, booking, token) {
      if (!validToken(token)) fail(403,'رابط متابعة الدفع غير صحيح.');
      const p=(await db.query('SELECT status,amount,currency FROM hotel_manual_payments WHERE booking_id=$1 AND access_token_hash=$2',[booking.id,hash(token)])).rows[0];
      if (!p) fail(403,'رابط متابعة الدفع غير صحيح.');
      return {...p,checkout_url:'/hotel-payment.html#'+booking.booking_code+':'+token};
    }
  };
}
async function customerPayment(db, req, lock=false) {
  const token=String(req.get('authorization') || '').replace(/^Bearer /,'');
  if (!validToken(token)) fail(404,'رابط متابعة الدفع غير صحيح.');
  const row=(await db.query(`SELECT p.*,b.booking_code,b.status booking_status,b.payment_status,b.total booking_total,b.currency booking_currency,h.name hotel_name,r.name room_name
    FROM hotel_manual_payments p JOIN hotel_bookings b ON b.id=p.booking_id JOIN hotels h ON h.id=b.hotel_id JOIN hotel_rooms r ON r.id=b.room_id
    WHERE b.booking_code=$1 AND p.access_token_hash=$2${lock?' FOR UPDATE OF b,p':''}`,[req.params.code,hash(token)])).rows[0];
  if (!row) fail(404,'رابط متابعة الدفع غير صحيح.');
  return row;
}
function publicReceipt(p, active) {
  const keys=['booking_code','booking_status','payment_status','booking_total','booking_currency','hotel_name','room_name','amount','currency','recipient','recipient_label','qr_url','exchange_rate','status','transaction_reference','review_note','submitted_at','reviewed_at'];
  return {...Object.fromEntries(keys.map(k=>[k,p[k]])),accepting_transfers:Boolean(active && p.booking_status==='pending' && p.status==='awaiting_transfer')};
}
async function referenceUnused(db, reference, paymentId) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('shamcash'),hashtext($1))",[reference]);
  const other=(await db.query(`SELECT id FROM hotel_manual_payments WHERE transaction_reference=$1 AND id<>$2 AND status IN ('pending_review','approved')`,[reference,paymentId])).rows[0];
  const wallet=(await db.query("SELECT id FROM payments WHERE provider='shamcash' AND provider_payment_id=$1",[reference])).rows[0];
  if (other || wallet) fail(409,'رقم التحويل مستخدم في طلب آخر.');
}
function register(app,{pool,requireAdmin,receiveQr,syncHotel=async()=>{}}) {
  app.get('/api/admin/shamcash-manual/settings',requireAdmin,async(req,res)=>{try{res.set('Cache-Control','no-store');res.json({data:await settings(pool)});}catch(e){sendError(res,e);}});
  app.put('/api/admin/shamcash-manual/settings',requireAdmin,sameOrigin,async(req,res)=>{
    let db;
    try {
      const b=req.body || {}, recipient=String(b.recipient||'').trim(), label=String(b.recipient_label||'').trim(), qr=String(b.qr_url||'').trim();
      const currency=String(b.currency||''), enabled=b.enabled===true, rate=b.usd_to_syp_rate==null||b.usd_to_syp_rate===''?null:Number(b.usd_to_syp_rate);
      if(recipient.length>240 || /[\x00-\x1f<>]/.test(recipient) || label.length>180 || (qr && !qrPath(qr)) || !['SYP','USD'].includes(currency) || (rate!==null && (!Number.isFinite(rate)||rate<=0||rate>1e8))) fail(400,'راجع حساب الاستلام والعملة وسعر الصرف.');
      if(enabled && (!label || (!recipient && !qr))) fail(400,'أضف اسم صاحب الحساب ورقم الاستلام أو رمز QR قبل التفعيل.');
      db=await pool.connect();await db.query('BEGIN');
      const saved=(await db.query(`UPDATE manual_shamcash_settings SET enabled=$1,recipient=$2,recipient_label=$3,qr_url=$4,currency=$5,usd_to_syp_rate=$6,version=version+1,updated_by=$7,updated_at=NOW() WHERE id=1 AND version=$8 RETURNING *`,[enabled,recipient,label,qr,currency,rate,req.user.id,Number(b.version)])).rows[0];
      if(!saved) fail(409,'تغيرت الإعدادات. حدّث الصفحة قبل الحفظ.');
      await db.query('INSERT INTO manual_shamcash_settings_audit(actor_user_id,settings) VALUES($1,$2)',[req.user.id,JSON.stringify(saved)]);
      await db.query('COMMIT');res.json({data:saved});
    }catch(e){if(db)await db.query('ROLLBACK');sendError(res,e);}finally{db?.release();}
  });
  if(receiveQr) app.post('/api/admin/shamcash-manual/qr',requireAdmin,sameOrigin,receiveQr,async(req,res)=>{
    try{
      if(!req.file) fail(400,'اختر صورة PNG أو JPEG أو WebP لرمز الاستلام.');
      const bytes=await fs.readFile(req.file.path),ext=require('node:path').extname(req.file.filename).toLowerCase();
      const valid=(ext==='.png' && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) || (['.jpg','.jpeg'].includes(ext) && bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))) || (ext==='.webp' && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP');
      if(!valid){await fs.unlink(req.file.path);fail(400,'ملف الصورة غير صالح.');}
      res.status(201).json({url:'/uploads/'+req.file.filename});
    }catch(e){sendError(res,e);}
  });
  app.get('/api/hotel-manual-payments/:code',async(req,res)=>{
    try{res.set('Cache-Control','no-store');const p=await customerPayment(pool,req);res.json({data:publicReceipt(p,await settings(pool).then(c=>c.enabled && c.version===p.settings_version))});}catch(e){sendError(res,e);}
  });
  app.post('/api/hotel-manual-payments/:code/submit',sameOrigin,async(req,res)=>{
    let db;
    try{
      const reference=String(req.body?.transaction_reference||'').trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).toUpperCase();
      if(!/^[A-Z0-9-]{3,80}$/.test(reference)) fail(400,'أدخل رقم التحويل الظاهر في تطبيق شام كاش.');
      db=await pool.connect();await db.query('BEGIN');const p=await customerPayment(db,req,true);
      if(p.booking_status!=='pending') fail(409,'الحجز ليس بانتظار التحويل.');
      if(p.status==='pending_review' && p.transaction_reference===reference){await db.query('COMMIT');return res.json({ok:true,status:'pending_review',repeated:true});}
      if(p.status!=='awaiting_transfer') fail(409,'لا يمكن تعديل تحويل تمت مراجعته أو إرساله.');
      await referenceUnused(db,reference,p.id);
      await db.query("UPDATE hotel_manual_payments SET transaction_reference=$2,status='pending_review',submitted_at=NOW() WHERE id=$1",[p.id,reference]);
      await db.query("INSERT INTO hotel_booking_events(booking_id,event_type,note) VALUES($1,'payment_submitted','أرسل العميل مرجع تحويل شام كاش؛ بانتظار التحقق اليدوي')",[p.booking_id]);
      await db.query('COMMIT');res.json({ok:true,status:'pending_review',message:'تم إرسال رقم التحويل. الحجز والدفع بانتظار مراجعة الإدارة.'});
    }catch(e){if(db)await db.query('ROLLBACK');sendError(res,e);}finally{db?.release();}
  });
  app.get('/api/admin/shamcash-manual/payments',requireAdmin,async(req,res)=>{
    try{res.set('Cache-Control','no-store');const data=(await pool.query(`SELECT p.id,p.amount,p.currency,p.recipient,p.recipient_label,p.status,p.transaction_reference,p.review_note,p.submitted_at,p.created_at,p.reviewed_at,b.booking_code,b.guest_name,b.guest_phone,b.status booking_status,h.name hotel_name FROM hotel_manual_payments p JOIN hotel_bookings b ON b.id=p.booking_id JOIN hotels h ON h.id=b.hotel_id ORDER BY CASE WHEN p.status='pending_review' THEN 0 ELSE 1 END,p.created_at DESC LIMIT 200`)).rows;res.json({data});}catch(e){sendError(res,e);}
  });
  app.post('/api/admin/shamcash-manual/payments/:id/review',requireAdmin,sameOrigin,async(req,res)=>{
    let db;
    try{
      const b=req.body||{}, action=b.action, note=String(b.note||'').trim();
      if(!['approve','reject'].includes(action) || note.length>1000) fail(400,'إجراء المراجعة غير صحيح.');
      if(action==='approve' && b.received_confirmed!==true) fail(400,'أكد مراجعة محفظة شام كاش واستلام المبلغ والعملة على الحساب المحدد.');
      if(action==='reject' && !note) fail(400,'اكتب سبب رفض التحويل.');
      db=await pool.connect();await db.query('BEGIN');
      const p=(await db.query(`SELECT p.*,b.hotel_id,b.status booking_status,b.payment_status FROM hotel_manual_payments p JOIN hotel_bookings b ON b.id=p.booking_id WHERE p.id=$1 FOR UPDATE OF b,p`,[req.params.id])).rows[0];
      if(!p) fail(404,'التحويل غير موجود.');
      const next=action==='approve'?'approved':'rejected';
      if(p.status===next){await db.query('COMMIT');return res.json({ok:true,status:next,repeated:true});}
      if(p.booking_status!=='pending' || p.payment_status==='paid') fail(409,'تغيرت حالة الحجز؛ لا يمكن اعتماد هذه الدفعة.');
      if(action==='approve' && p.status!=='pending_review') fail(409,'لم يرسل العميل رقم تحويل للمراجعة.');
      if(!['awaiting_transfer','pending_review'].includes(p.status)) fail(409,'تمت مراجعة هذه الدفعة سابقًا.');
      if(action==='approve') await referenceUnused(db,p.transaction_reference,p.id);
      await db.query('UPDATE hotel_manual_payments SET status=$2,reviewed_by=$3,reviewed_at=NOW(),review_note=$4 WHERE id=$1',[p.id,next,req.user.id,note||null]);
      await db.query("UPDATE hotel_bookings SET status=$2,payment_status=$3,updated_at=NOW() WHERE id=$1",[p.booking_id,action==='approve'?'confirmed':'cancelled',action==='approve'?'paid':'pending']);
      await db.query('UPDATE hotel_invoices SET status=$2 WHERE booking_id=$1',[p.booking_id,action==='approve'?'paid':'cancelled']);
      await db.query('INSERT INTO hotel_booking_events(booking_id,event_type,note,actor_user_id) VALUES($1,$2,$3,$4)',[p.booking_id,'manual_payment_'+next,action==='approve'?'أكد المدير وصول تحويل شام كاش':note,req.user.id]);
      await db.query('COMMIT');res.json({ok:true,status:next});
      Promise.resolve().then(()=>syncHotel(pool,p.hotel_id)).catch(e=>console.error('Manual hotel availability sync:',e.message));
    }catch(e){if(db)await db.query('ROLLBACK');sendError(res,e);}finally{db?.release();}
  });
}
module.exports={createService,register,option,settings,hash,ManualPaymentError};
