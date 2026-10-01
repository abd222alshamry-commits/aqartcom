'use strict';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
function createService({pool,sendEmail,sendPush,emailReady=()=>false,pushReady=()=>false,syncHotel=async()=>{}}){
 async function enqueue(db,b,event){
  const h=(await db.query('SELECT h.*,o.owner_id office_owner FROM hotels h LEFT JOIN offices o ON o.id=h.office_id WHERE h.id=$1',[b.hotel_id])).rows[0];
  const managers=(await db.query(`SELECT DISTINCT u.id,u.email FROM users u WHERE u.is_active=TRUE AND (u.id=$1 OR u.id=$2 OR (u.office_id=$3 AND u.role='agent'))`,[h.owner_id,h.office_owner,h.office_id])).rows;
  const url=`/hotel-partner.html?hotel=${b.hotel_id}&tab=bookings`;
  const titles={requested:'طلب حجز جديد بانتظار تأكيد الفندق',approved:b.status==='confirmed'?'تم تأكيد الحجز من الفندق':'وافق الفندق على الطلب — بانتظار الدفع',rejected:'رفض الفندق طلب الحجز',cancelled:'تم إلغاء الحجز',payment_confirmed:b.status==='confirmed'?'تم تأكيد الحجز والدفعة':'تم استلام الدفعة — بانتظار تأكيد الفندق'};
  const title=titles[event]||'تحديث طلب الحجز';
  const body=`${h.name} — ${b.booking_code}\n${day(b.check_in)} إلى ${day(b.check_out)} · ${b.rooms_count} غرفة · ${b.total} ${b.currency}${(event==='cancelled'?b.cancellation_reason:b.approval_note)?'\n'+(event==='cancelled'?b.cancellation_reason:b.approval_note):''}`;
  const recipients=[...(['requested','cancelled'].includes(event)?managers.map(u=>({...u,manager:true})):[]),...(event!=='requested'&&b.user_id?[{id:b.user_id,email:b.guest_email,manager:false}]:[])];
  const key=`hotel:${b.id}:${event}`;
  for(const u of recipients){
   const target=u.manager?url:`/hotels.html#booking=${b.booking_code}`;
   await db.query(`INSERT INTO user_notifications(user_id,type,title,body,hotel_booking_id,action_url,event_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(event_key,user_id) DO NOTHING`,[u.id,'hotel_booking_'+event,title,body,b.id,target,key]);
   await db.query(`INSERT INTO hotel_notification_outbox(booking_id,event_key,channel,recipient,user_id,title,body,action_url) VALUES($1,$2,'push',$3,$4,$5,$6,$7) ON CONFLICT(event_key,channel,recipient) DO NOTHING`,[b.id,key,String(u.id),u.id,title,body,target]);
  }
  const owner=managers.find(u=>String(u.id)===String(h.owner_id))||managers.find(u=>String(u.id)===String(h.office_owner));
  const emails=[...(['requested','cancelled'].includes(event)?[{email:h.booking_email||owner?.email,target:url}]:[]),...(event!=='requested'?[{email:b.guest_email,target:`/hotels.html#booking=${b.booking_code}`}]:[])];
  for(const {email,target} of emails)if(email)await db.query(`INSERT INTO hotel_notification_outbox(booking_id,event_key,channel,recipient,title,body,action_url) VALUES($1,$2,'email',$3,$4,$5,$6) ON CONFLICT(event_key,channel,recipient) DO NOTHING`,[b.id,key,email,title,body+(event==='requested'?'\nاسم الضيف: '+b.guest_name+'\nالهاتف: '+b.guest_phone:''),target]);
 }
 let running=false;
 async function drain(){
  if(running)return;running=true;
  try{for(let i=0;i<20;i++){
   const channels=[...(emailReady()?['email']:[]),...(pushReady()?['push']:[])];if(!channels.length)return;
   const job=(await pool.query(`UPDATE hotel_notification_outbox SET status='sending',locked_at=NOW(),attempts=attempts+1 WHERE id=(SELECT id FROM hotel_notification_outbox WHERE channel=ANY($1::text[]) AND ((status='queued' AND next_attempt_at<=NOW()) OR (status='sending' AND locked_at<NOW()-INTERVAL '10 minutes')) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,[channels])).rows[0];if(!job)break;
   try{
    // Do not email an obsolete request after the hotel has already made its decision.
    const b=(await pool.query('SELECT status,approval_status FROM hotel_bookings WHERE id=$1',[job.booking_id])).rows[0];
    if(!b || ([':approved',':payment_confirmed'].some(event=>job.event_key.endsWith(event))&&b.status==='cancelled') || (job.event_key.endsWith(':requested')&&(b.approval_status!=='pending'||b.status!=='pending'))){await pool.query("UPDATE hotel_notification_outbox SET status='superseded' WHERE id=$1",[job.id]);continue;}
    if(job.channel==='email')await sendEmail(job);else await sendPush(job);
    await pool.query("UPDATE hotel_notification_outbox SET status='sent',sent_at=NOW(),last_error=NULL WHERE id=$1",[job.id]);
   }catch(e){await pool.query("UPDATE hotel_notification_outbox SET status=$2,next_attempt_at=NOW()+($3::int*INTERVAL '1 second'),last_error=$4 WHERE id=$1",[job.id,job.attempts>=8?'failed':'queued',Math.min(21600,30*2**job.attempts),'تعذر التسليم؛ ستتم إعادة المحاولة']);console.error('Hotel notification delivery failed:',job.id,job.channel,e.code||'provider_error');}
  }}finally{running=false;}
 }
 function wake(){drain().catch(e=>console.error('Hotel notification queue:',e.code||'database_error'));}
 async function decide(req){
  let db;
  try{
   const status=String(req.body.status||''),note=String(req.body.note||'').trim();
   if(!['confirmed','cancelled','completed','no_show'].includes(status)||note.length>1000)fail(400,'إجراء الحجز غير صحيح');
   db=await pool.connect();await db.query('BEGIN');
   const b=(await db.query(`SELECT b.* FROM hotel_bookings b JOIN hotels h ON h.id=b.hotel_id WHERE b.id=$1 AND (h.office_id=$2 OR h.owner_id=$3 OR $4::boolean) FOR UPDATE OF b`,[req.params.id,req.office.id,req.office.owner_id,req.office.platform_admin===true])).rows[0];
   if(!b)fail(404,'الحجز غير موجود');
   const approving=status==='confirmed',rejecting=status==='cancelled'&&b.approval_status==='pending';
   if(approving&&b.approval_status==='approved'&&['pending','confirmed'].includes(b.status)){await db.query('COMMIT');return {data:b,repeated:true};}
   if(status===b.status&&!approving){await db.query('COMMIT');return {data:b,repeated:true};}
   if(!['pending','confirmed'].includes(b.status))fail(409,'سبق إنهاء هذا الطلب؛ حدّث قائمة الحجوزات');
   if(approving&&b.approval_status!=='pending')fail(409,'هذا الحجز ليس بانتظار موافقة الفندق');
   if(rejecting&&!note)fail(400,'اكتب سبب رفض طلب الحجز');
   const today=require('./stay-inventory').today();
   if(approving&&day(b.check_in)<today)fail(409,'تاريخ الوصول مضى؛ لا يمكن قبول الطلب');
   if(['completed','no_show'].includes(status)&&(b.status!=='confirmed'||day(status==='completed'?b.check_out:b.check_in)>=today))fail(409,'لا يمكن تغيير حالة الإقامة قبل موعدها');
   const next=approving?(b.payment_method==='shamcash_manual'&&b.payment_status!=='paid'?'pending':'confirmed'):status;
   const decision=approving?'approved':rejecting?'rejected':b.approval_status;
   const updated=(await db.query(`UPDATE hotel_bookings SET status=$2::varchar,approval_status=$3,approval_note=CASE WHEN $4::boolean THEN $5 ELSE approval_note END,approved_by=CASE WHEN $4::boolean THEN $6 ELSE approved_by END,decided_at=CASE WHEN $4::boolean THEN NOW() ELSE decided_at END,cancelled_at=CASE WHEN $2::varchar='cancelled' THEN NOW() ELSE cancelled_at END,cancellation_reason=CASE WHEN $2::varchar='cancelled' THEN $5 ELSE cancellation_reason END,updated_at=NOW() WHERE id=$1 RETURNING *`,[b.id,next,decision,approving||rejecting,note||null,req.user.id])).rows[0];
   const event=approving?'approved':rejecting?'rejected':status;
   await db.query('INSERT INTO hotel_booking_events(booking_id,event_type,note,actor_user_id) VALUES($1,$2,$3,$4)',[b.id,'hotel_'+event,note||'تحديث من إدارة الفندق',req.user.id]);
   if(next==='cancelled')await db.query("UPDATE hotel_invoices SET status='cancelled' WHERE booking_id=$1 AND status<>'paid'",[b.id]);
   if(['approved','rejected','cancelled'].includes(event))await enqueue(db,updated,event);
   await db.query('COMMIT');wake();Promise.resolve(syncHotel(pool,b.hotel_id)).catch(()=>{});return {data:updated};
  }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db?.release();}
 }
 async function cancelGuest(code,reason){
  let db;
  try{
   db=await pool.connect();await db.query('BEGIN');
   const b=(await db.query(`SELECT b.*,h.name hotel_name,h.city hotel_city,h.district hotel_district,r.name room_name FROM hotel_bookings b JOIN hotels h ON h.id=b.hotel_id JOIN hotel_rooms r ON r.id=b.room_id WHERE b.booking_code=$1 FOR UPDATE OF b`,[code])).rows[0];
   if(!b)fail(404,'الحجز غير موجود');
   if(b.status==='cancelled'){await db.query('COMMIT');return {data:b,repeated:true};}
   if(!['pending','confirmed'].includes(b.status))fail(409,'لا يمكن إلغاء هذا الحجز');
   if(b.approval_status!=='pending'&&(!b.cancellation_deadline||Date.now()>new Date(b.cancellation_deadline).getTime()))fail(409,'انتهت مهلة الإلغاء المجاني');
   const note=String(reason||'إلغاء من الضيف').trim().slice(0,500);
   const updated=(await db.query("UPDATE hotel_bookings SET status='cancelled',cancelled_at=NOW(),cancellation_reason=$2,updated_at=NOW() WHERE id=$1 RETURNING *",[b.id,note])).rows[0];
   await db.query("UPDATE hotel_invoices SET status='cancelled' WHERE booking_id=$1 AND status<>'paid'",[b.id]);
   await db.query("INSERT INTO hotel_booking_events(booking_id,event_type,note) VALUES($1,'cancelled',$2)",[b.id,note]);
   await enqueue(db,updated,'cancelled');await db.query('COMMIT');wake();Promise.resolve(syncHotel(pool,b.hotel_id)).catch(()=>{});
   return {data:{...b,...updated},refund_eligible:b.payment_status==='paid'};
  }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db?.release();}
 }
 function register(app,{requireOfficeMember,ownedHotel}){
  const sameOrigin=(req,res,next)=>{const origin=req.get('origin');if(origin&&origin!==`${req.protocol}://${req.get('host')}`&&origin!==process.env.APP_URL)return res.status(403).json({error:'مصدر الطلب غير مسموح'});next();};
  app.patch('/api/office/hotel-bookings/:id',requireOfficeMember,sameOrigin,async(req,res)=>{try{res.json(await decide(req));}catch(e){if(!e.status)console.error('Hotel decision:',e.message);res.status(e.status||500).json({error:e.status?e.message:'تعذر تحديث طلب الحجز'});}});
  app.get('/api/office/hotels/:id/booking-notifications',requireOfficeMember,async(req,res)=>{try{
   const h=await ownedHotel(req.params.id,req.office);if(!h)return res.status(404).json({error:'الفندق غير موجود'});
   const owner=(await pool.query('SELECT u.email FROM hotels h LEFT JOIN offices o ON o.id=h.office_id JOIN users u ON u.id=COALESCE(h.owner_id,o.owner_id) WHERE h.id=$1',[req.params.id])).rows[0];
   res.json({email:h.booking_email||owner?.email||null,custom_email:h.booking_email||'',email_ready:emailReady(),pending:(await pool.query("SELECT COUNT(*)::int count FROM hotel_bookings WHERE hotel_id=$1 AND status='pending' AND approval_status='pending'",[req.params.id])).rows[0].count});
  }catch(e){res.status(500).json({error:'تعذر تحميل إعدادات الإشعارات'});}});
  app.put('/api/office/hotels/:id/booking-notifications',requireOfficeMember,sameOrigin,async(req,res)=>{try{
   if(!await ownedHotel(req.params.id,req.office))return res.status(404).json({error:'الفندق غير موجود'});
   const email=String(req.body.email||'').trim().toLowerCase();if(email&&(email.length>220||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)))return res.status(400).json({error:'أدخل بريد مدير الفندق بشكل صحيح'});
   await pool.query('UPDATE hotels SET booking_email=$2,updated_at=NOW() WHERE id=$1',[req.params.id,email||null]);res.json({ok:true});
  }catch(e){res.status(500).json({error:'تعذر حفظ بريد الفندق'});}});
 }
 return {enqueue,drain,wake,decide,cancelGuest,register,start(){
  console.log('Hotel booking email configured:',emailReady());
  if(emailReady())require('./smtp-diagnostics').verifySmtp().catch(()=>console.error('Hotel booking SMTP verification: unavailable'));
  const timer=setInterval(wake,30000);timer.unref();wake();return timer;
 }};
}
module.exports={createService};
