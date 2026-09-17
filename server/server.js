require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const multer = require('multer');
const { execFile } = require('child_process');
const { syncHotel, ingestExternalBooking, discoverCatalog, getMappingSuggestions, testConnection, syncInitial365, fetchExternalReservations, refreshAffectedInventory } = require('./hotel-channel-manager');
const os = require('os');
let nodemailer=null, webpush=null;
try { nodemailer=require('nodemailer'); } catch(_) {}
try { webpush=require('web-push'); } catch(_) {}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
if (!process.env.APP_URL && process.env.RENDER_EXTERNAL_URL) process.env.APP_URL = process.env.RENDER_EXTERNAL_URL;
const SESSION_COOKIE = 'aqartkom_session';
const SESSION_DAYS = 30;

async function bootstrap() {
await ensureSchema();

app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(), geolocation=(self), microphone=(self)');if(isProduction)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');next();});
const rateBuckets=new Map(); app.use('/api',(req,res,next)=>{const key=req.ip||'unknown',now=Date.now(),windowMs=60000,limit=Number(process.env.API_RATE_LIMIT_PER_MINUTE||180);let b=rateBuckets.get(key);if(!b||now-b.start>windowMs)b={start:now,count:0};b.count++;rateBuckets.set(key,b);if(b.count>limit)return res.status(429).json({error:'طلبات كثيرة، حاول بعد قليل'});next();});
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(x=>x.trim()) : (isProduction ? false : true), credentials: true }));
app.use(express.text({ type: ['application/xml','text/xml','application/*+xml'], limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));
const storage = multer.diskStorage({ destination: (_req,_file,cb)=>cb(null, uploadDir), filename: (_req,file,cb)=>{ const ext=path.extname(file.originalname).toLowerCase(); cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`); } });
const imageUpload = multer({ storage, limits: { files: 12, fileSize: 8*1024*1024 }, fileFilter: (_req,file,cb)=>cb(null, /^image\/(jpeg|png|webp|jpg)$/.test(file.mimetype)) });
const videoUpload = multer({ storage, limits: { files: 3, fileSize: 100*1024*1024 }, fileFilter: (_req,file,cb)=>cb(null, /^video\/(mp4|webm|quicktime)$/.test(file.mimetype)) });
function uploadErrorMessage(error, kind) {
  if (error?.code === 'LIMIT_FILE_SIZE') return kind === 'image' ? 'حجم الصورة يتجاوز 8 ميغابايت.' : 'حجم الفيديو يتجاوز 100 ميغابايت.';
  if (error instanceof multer.MulterError) return `تعذر استقبال ${kind === 'image' ? 'الصور' : 'الفيديوهات'}: ${error.message}`;
  return kind === 'image' ? 'اختر صور JPEG أو PNG أو WebP صالحة.' : 'اختر فيديو MP4 أو MOV أو WebM صالحًا.';
}
const receiveImages = (req,res,next) => imageUpload.array('images',12)(req,res,error => error ? res.status(400).json({error:uploadErrorMessage(error,'image')}) : next());
const receiveVideos = (req,res,next) => videoUpload.array('videos',3)(req,res,error => error ? res.status(400).json({error:uploadErrorMessage(error,'video')}) : next());
function createVideoPoster(filePath) {
  const parsed=path.parse(filePath),posterPath=path.join(parsed.dir,parsed.name+'.jpg');
  return new Promise(resolve=>execFile('ffmpeg',['-nostdin','-v','error','-ss','0.5','-i',filePath,'-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease','-y',posterPath],{timeout:20000},error=>{
    if(error){try{fs.unlinkSync(posterPath)}catch{};return resolve(null);}
    resolve('/uploads/'+path.basename(posterPath));
  }));
}
app.use(require('./public-files')(path.join(__dirname, '..')));

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/'
  });
}
function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
}
function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').filter(Boolean).map(part => {
    const i = part.indexOf('=');
    return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }));
}

async function createSession(userId, res) {
  const token = newToken();
  const hash = tokenHash(token);
  await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
  await pool.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,NOW() + INTERVAL \'30 days\')', [userId, hash]);
  setSessionCookie(res, token);
}

async function getCurrentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const result = await pool.query(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.is_host, u.admin_permissions, u.is_active, u.created_at, u.office_id, u.office_title
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at > NOW() AND u.is_active=TRUE
  `, [tokenHash(token)]);
  return result.rows[0] || null;
}

async function requireAdmin(req,res,next){ try { const user=await getCurrentUser(req); if(!user) return res.status(401).json({error:'يجب تسجيل الدخول أولاً'}); if(user.role!=='admin') return res.status(403).json({error:'ليس لديك صلاحية الإدارة'}); if(!require('./admin-permissions').allowed(user,req))return res.status(403).json({error:'هذا الإجراء خارج الصلاحيات الممنوحة لحسابك'}); req.user=user; next(); } catch(e){ console.error(e); res.status(500).json({error:'تعذر التحقق من صلاحيات الإدارة'}); } }

async function requireAuth(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
    req.user = user;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'تعذر التحقق من الحساب' });
  }
}

async function ensureAdminFromEnv(){
  const email=normalizeEmail(process.env.ADMIN_EMAIL);
  if(!email)return;
  const existing=(await pool.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)',[email])).rows[0];
  if(existing){
    await pool.query("UPDATE users SET role='admin',admin_permissions=NULL,is_active=TRUE,updated_at=NOW() WHERE id=$1",[existing.id]);
    console.log('Owner admin ready:',email,'existing account');
    return;
  }
  const password=String(process.env.ADMIN_PASSWORD||'');
  if(password.length<8){console.warn('Owner admin pending: configured account does not exist and bootstrap password is unavailable');return;}
  const hash=await bcrypt.hash(password,12);
  await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')",[process.env.ADMIN_NAME||'مدير عقارتكم',email,hash]);
  console.log('Owner admin ready:',email,'initialized account');
}

async function ensureSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
}


async function requireOffice(req,res,next){
  try {
    const user=await getCurrentUser(req);
    if(!user) return res.status(401).json({error:'يجب تسجيل الدخول أولاً'});
    if(!['agent','admin'].includes(user.role)) return res.status(403).json({error:'نظام المكاتب متاح للحسابات العقارية فقط'});
    if(user.role==='admin' && !require('./admin-permissions').full(user))return res.status(403).json({error:'هذا القسم خارج صلاحيات حساب الإدارة المحدود'});
    req.user=user; next();
  } catch(e){ console.error(e); res.status(500).json({error:'تعذر التحقق من صلاحيات المكتب'}); }
}
async function getOfficeForUser(userId){
  const r=await pool.query(`SELECT o.*, u.name owner_name FROM offices o JOIN users u ON u.id=o.owner_id WHERE o.owner_id=$1 OR o.id=(SELECT office_id FROM users WHERE id=$1) LIMIT 1`,[userId]);
  return r.rows[0]||null;
}
async function requireOfficeMember(req,res,next){
  try {
    const user=await getCurrentUser(req); if(!user) return res.status(401).json({error:'يجب تسجيل الدخول أولاً'});
    if(user.role==='user' && user.is_host && require('./host-portal').hostPath(req)){req.user=user;req.office={id:null,owner_id:user.id};return next();}
    if(!['agent','admin'].includes(user.role)) return res.status(403).json({error:'صلاحية المكتب غير متاحة لهذا الحساب'});
    if(user.role==='admin' && !require('./admin-permissions').allowed(user,req))return res.status(403).json({error:'هذا الإجراء خارج الصلاحيات الممنوحة لحسابك'});
    // Platform administrators manage hotels globally; partner accounts remain office-scoped.
    if(user.role==='admin' && /^\/api\/office\/hotels?(?:[-/]|$)/.test(req.path)) {
      req.user=user; req.office={id:null,owner_id:user.id,platform_admin:true}; return next();
    }
    const office=await getOfficeForUser(user.id);
    if(!office) return res.status(404).json({error:'لا يوجد مكتب مرتبط بحسابك'});
    req.user=user; req.office=office; next();
  } catch(e){ console.error(e); res.status(500).json({error:'تعذر تحميل المكتب'}); }
}
function officeSlug(name){ return String(name||'').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,180)||('office-'+Date.now()); }


// ---------------- Multi-channel notification delivery ----------------
const DEFAULT_CHANNELS={in_app:true,push:false,email:false,whatsapp:false};
function normalizeChannels(input){
  const x={...DEFAULT_CHANNELS,...(input||{})};
  return {in_app:Boolean(x.in_app),push:Boolean(x.push),email:Boolean(x.email),whatsapp:Boolean(x.whatsapp)};
}
function notificationConfig(){
  return {
    emailReady:Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    pushReady:Boolean(webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    whatsappReady:Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  };
}
if(webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY){
  webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@aqartkom.sy',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
}
async function logDelivery({userId,savedSearchId,propertyId,channel,status,provider,error=null}){
  try{await pool.query(`INSERT INTO notification_deliveries(user_id,saved_search_id,property_id,channel,status,provider,error) VALUES($1,$2,$3,$4,$5,$6,$7)`,[userId,savedSearchId||null,propertyId||null,channel,status,provider||null,error?String(error).slice(0,1000):null]);}catch(e){console.error('delivery log error',e);}
}
async function sendEmailNotification(user, title, body, propertyId){
  if(!nodemailer || !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error('SMTP غير مضبوط');
  const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  const base=process.env.APP_URL||`http://localhost:${port}`;
  await transporter.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:user.email,subject:title,text:`${body}\n${propertyId?base+'/property.html?id='+propertyId:''}`,html:`<div dir="rtl" style="font-family:Arial"><h2>${title}</h2><p>${body}</p>${propertyId?`<p><a href="${base}/property.html?id=${encodeURIComponent(propertyId)}">عرض العقار</a></p>`:''}</div>`});
}
async function sendPushNotification(userId,title,body,propertyId){
  if(!webpush || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) throw new Error('Push غير مضبوط');
  const r=await pool.query('SELECT * FROM push_subscriptions WHERE user_id=$1',[userId]);
  for(const sub of r.rows){
    try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify({title,body,url:propertyId?`/property.html?id=${propertyId}`:'/'}));}
    catch(e){if(e.statusCode===404||e.statusCode===410) await pool.query('DELETE FROM push_subscriptions WHERE id=$1',[sub.id]); else throw e;}
  }
}
async function sendWhatsAppNotification(user,title,body,propertyId){
  const token=process.env.WHATSAPP_ACCESS_TOKEN, phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID;
  if(!token||!phoneId) throw new Error('WhatsApp غير مضبوط');
  if(!user.phone) throw new Error('لا يوجد رقم واتساب للمستخدم');
  const to=String(user.phone).replace(/[^0-9]/g,''); if(!to) throw new Error('رقم الهاتف غير صالح');
  const base=process.env.APP_URL||`http://localhost:${port}`;
  const text=`${title}\n${body}${propertyId?`\n${base}/property.html?id=${propertyId}`:''}`;
  const resp=await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{preview_url:true,body:text}})});
  if(!resp.ok) throw new Error(`WhatsApp HTTP ${resp.status}: ${await resp.text()}`);
}
async function dispatchSavedSearchNotification(s,property){
  const channels=normalizeChannels(s.notification_channels);
  const userQ=await pool.query('SELECT id,name,email,phone FROM users WHERE id=$1',[s.user_id]); const user=userQ.rows[0]; if(!user)return;
  const title=`عقار جديد يطابق «${s.name}»`;
  const body=`تمت إضافة عقار جديد يطابق معايير بحثك: ${property.title}`;
  const tasks=[];
  if(channels.in_app) tasks.push((async()=>{try{await pool.query(`INSERT INTO user_notifications(user_id,type,title,body,property_id,saved_search_id) VALUES($1,'property_match',$2,$3,$4,$5)`,[s.user_id,title,body,property.id,s.id]);await logDelivery({userId:s.user_id,savedSearchId:s.id,propertyId:property.id,channel:'in_app',status:'sent',provider:'aqartkom'});}catch(e){await logDelivery({userId:s.user_id,savedSearchId:s.id,propertyId:property.id,channel:'in_app',status:'failed',provider:'aqartkom',error:e.message});}})());
  if(channels.push) tasks.push((async()=>{try{await sendPushNotification(s.user_id,title,body,property.id);await logDelivery({userId:s.user_id,savedSearchId:s.id,propertyId:property.id,channel:'push',status:'sent',provider:'web-push'});}catch(e){await logDelivery({userId:s.user_id,savedSearchId:s.id,propertyId:property.id,channel:'push',status:'failed',provider:'web-push',error:e.message});}})());
  if(channels.email) tasks.push((async()=>{try{await sendEmailNotification(user,title,body,property.id);await logDelivery({userId:s.user_id,savedSearchId:s.id,propertyId:property.id,channel:'email',status:'sent',provider:'smtp'});}catch(e){await logDelivery({userId:s.user_id,savedSearchId:s.id,propertyId:property.id,channel:'email',status:'failed',provider:'smtp',error:e.message});}})());
  if(channels.whatsapp) tasks.push((async()=>{try{await sendWhatsAppNotification(user,title,body,property.id);await logDelivery({userId:s.user_id,savedSearchId:s.id,propertyId:property.id,channel:'whatsapp',status:'sent',provider:'meta-whatsapp'});}catch(e){await logDelivery({userId:s.user_id,savedSearchId:s.id,propertyId:property.id,channel:'whatsapp',status:'failed',provider:'meta-whatsapp',error:e.message});}})());
  await Promise.all(tasks);
}



// ---------------- V20 Hotel finance, cancellation, calendar ----------------
app.get('/api/hotel-bookings/:code', async(req,res)=>{try{
  const r=await pool.query(`SELECT b.*,h.name hotel_name,r.name room_name FROM hotel_bookings b JOIN hotels h ON h.id=b.hotel_id JOIN hotel_rooms r ON r.id=b.room_id WHERE b.booking_code=$1 LIMIT 1`,[req.params.code]);
  if(!r.rows[0]) return res.status(404).json({error:'الحجز غير موجود'});
  res.json({data:r.rows[0]});
}catch(e){res.status(500).json({error:'تعذر تحميل الحجز'});}});

app.post('/api/hotel-bookings/:code/cancel', async(req,res)=>{try{
  const r=await pool.query(`SELECT * FROM hotel_bookings WHERE booking_code=$1 LIMIT 1`,[req.params.code]);
  const b=r.rows[0]; if(!b)return res.status(404).json({error:'الحجز غير موجود'});
  if(['cancelled','completed','no_show'].includes(b.status))return res.status(400).json({error:'لا يمكن إلغاء هذا الحجز'});
  if(b.cancellation_deadline && new Date()>new Date(b.cancellation_deadline))return res.status(400).json({error:'انتهت مهلة الإلغاء المجاني'});
  const reason=String(req.body?.reason||'إلغاء من العميل').slice(0,500);
  const up=await pool.query(`UPDATE hotel_bookings SET status='cancelled',cancelled_at=NOW(),cancellation_reason=$1,updated_at=NOW() WHERE id=$2 RETURNING *`,[reason,b.id]);
  await pool.query(`INSERT INTO hotel_booking_events(booking_id,event_type,note,actor_user_id) VALUES($1,'cancelled',$2,$3)`,[b.id,reason,req.user?.id||null]);
  res.json({data:up.rows[0],refund_eligible:b.payment_status==='paid'});
}catch(e){console.error(e);res.status(500).json({error:'تعذر إلغاء الحجز'});}});

app.get('/api/office/hotels/:id/finance', requireOfficeMember, async(req,res)=>{try{
  if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});
  const id=req.params.id;
  const [summary,monthly,recent]=await Promise.all([
    pool.query(`SELECT COUNT(*)::int bookings,COALESCE(SUM(total) FILTER (WHERE status NOT IN ('cancelled')),0) gross,COALESCE(SUM(commission_amount) FILTER (WHERE status NOT IN ('cancelled')),0) commission,COALESCE(SUM(net_amount) FILTER (WHERE status NOT IN ('cancelled')),0) net,COALESCE(SUM(total) FILTER (WHERE status='cancelled'),0) cancelled_value FROM hotel_bookings WHERE hotel_id=$1`,[id]),
    pool.query(`SELECT TO_CHAR(date_trunc('month',created_at),'YYYY-MM') AS "month",COUNT(*)::int bookings,COALESCE(SUM(total) FILTER (WHERE status NOT IN ('cancelled')),0) gross,COALESCE(SUM(commission_amount) FILTER (WHERE status NOT IN ('cancelled')),0) commission,COALESCE(SUM(net_amount) FILTER (WHERE status NOT IN ('cancelled')),0) net FROM hotel_bookings WHERE hotel_id=$1 AND created_at>=NOW()-INTERVAL '12 months' GROUP BY 1 ORDER BY 1`,[id]),
    pool.query(`SELECT booking_code,guest_name,check_in,check_out,total,currency,commission_amount,net_amount,status,created_at FROM hotel_bookings WHERE hotel_id=$1 ORDER BY created_at DESC LIMIT 100`,[id])
  ]);
  const rate=(await pool.query(`SELECT platform_commission_rate FROM hotels WHERE id=$1`,[id])).rows[0]?.platform_commission_rate||0;
  res.json({commission_rate:Number(rate),summary:summary.rows[0],monthly:monthly.rows,recent:recent.rows});
}catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل الحسابات'});}});

app.patch('/api/office/hotels/:id/commission', requireOfficeMember, async(req,res)=>{try{
  if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});
  const rate=Math.min(100,Math.max(0,Number(req.body?.rate)||0));
  const r=await pool.query(`UPDATE hotels SET platform_commission_rate=$1,updated_at=NOW() WHERE id=$2 RETURNING id,platform_commission_rate`,[rate,req.params.id]);
  res.json({data:r.rows[0]});
}catch(e){res.status(500).json({error:'تعذر تعديل نسبة العمولة'});}});

app.get('/api/office/hotels/:id/calendar', requireOfficeMember, async(req,res)=>{try{
  if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});
  const from=req.query.from||new Date().toISOString().slice(0,10); const to=req.query.to||new Date(Date.now()+60*86400000).toISOString().slice(0,10);
  const rooms=(await pool.query(`SELECT id,name,quantity FROM hotel_rooms WHERE hotel_id=$1 ORDER BY name`,[req.params.id])).rows;
  const bookings=(await pool.query(`SELECT booking_code,room_id,check_in,check_out,rooms_count,status,guest_name FROM hotel_bookings WHERE hotel_id=$1 AND check_in < $3::date AND check_out > $2::date AND status IN ('pending','confirmed') ORDER BY check_in`,[req.params.id,from,to])).rows;
  const blocks=(await pool.query(`SELECT room_id,start_date,end_date,quantity,reason FROM hotel_availability_blocks WHERE room_id IN (SELECT id FROM hotel_rooms WHERE hotel_id=$1) AND start_date < $3::date AND end_date > $2::date ORDER BY start_date`,[req.params.id,from,to])).rows;
  res.json({from,to,rooms,bookings,blocks});
}catch(e){res.status(500).json({error:'تعذر تحميل تقويم الفندق'});}});

// ---------------- V19 Hotel booking + partner APIs ----------------
function hotelAccessWhere(officeId){ return [officeId]; }
async function ownedHotel(id, office){
  const r=await pool.query(`SELECT * FROM hotels WHERE id=$1 AND (office_id=$2 OR owner_id=$3 OR $4::boolean) LIMIT 1`,[id,office.id,office.owner_id,office.platform_admin===true]);
  return r.rows[0]||null;
}
function dateValid(a,b){ return /^\d{4}-\d{2}-\d{2}$/.test(String(a||'')) && /^\d{4}-\d{2}-\d{2}$/.test(String(b||'')) && new Date(b)>new Date(a); }
async function roomAvailability(roomId,checkIn,checkOut,requested=1){
  const room=(await pool.query(`SELECT * FROM hotel_rooms WHERE id=$1`,[roomId])).rows[0];
  if(!room) return {ok:false,room:null,available:0};
  const booked=(await pool.query(`SELECT COALESCE(SUM(rooms_count),0)::int n FROM hotel_bookings WHERE room_id=$1 AND status IN ('pending','confirmed') AND check_in < $3 AND check_out > $2`,[roomId,checkIn,checkOut])).rows[0].n;
  const blocked=(await pool.query(`SELECT COALESCE(SUM(quantity),0)::int n FROM hotel_availability_blocks WHERE room_id=$1 AND start_date < $3 AND end_date > $2`,[roomId,checkIn,checkOut])).rows[0].n;
  const available=Math.max(0,Number(room.quantity)-Number(booked)-Number(blocked));
  return {ok:available>=requested,room,available};
}
async function roomEffectivePrice(room,checkIn){
  const rate=(await pool.query(`SELECT price,currency FROM hotel_room_rates WHERE room_id=$1 AND start_date <= $2 AND end_date > $2 ORDER BY created_at DESC LIMIT 1`,[room.id,checkIn])).rows[0];
  return rate||{price:room.price,currency:room.currency};
}
async function hotelDiscount(hotelId,checkIn,checkOut){
  const r=await pool.query(`SELECT COALESCE(MAX(discount_percent),0) discount FROM hotel_promotions WHERE hotel_id=$1 AND active=TRUE AND start_date <= $2 AND end_date >= $3`,[hotelId,checkIn,checkOut]);
  return Number(r.rows[0]?.discount||0);
}
app.get('/api/hotels', async(req,res)=>{try{
  const q=String(req.query.q||'').trim(), city=String(req.query.city||'').trim(), ci=String(req.query.checkIn||''), co=String(req.query.checkOut||''), adults=Math.max(1,Number(req.query.adults)||1), rooms=Math.max(1,Number(req.query.rooms)||1);
  const vals=[]; const where=[`h.status='active'`]; if(req.query.lodging_type){if(!require('./host-portal').types.includes(req.query.lodging_type))return res.status(400).json({error:'نوع المنشأة غير صحيح'});vals.push(req.query.lodging_type);where.push(`h.lodging_type=$${vals.length}`);} if(city){vals.push(city);where.push(`h.city=$${vals.length}`);} if(q){vals.push(`%${q}%`);where.push(`(h.name ILIKE $${vals.length} OR h.city ILIKE $${vals.length} OR COALESCE(h.district,'') ILIKE $${vals.length})`);}
  const r=await pool.query(`SELECT h.*,COALESCE(MIN(r.price),0) min_price,COALESCE(MIN(r.currency),'USD') currency,(SELECT COALESCE(AVG(rw.rating),0) FROM hotel_reviews rw WHERE rw.hotel_id=h.id AND rw.status='published') review_score,(SELECT COUNT(*) FROM hotel_reviews rw2 WHERE rw2.hotel_id=h.id AND rw2.status='published') review_count FROM hotels h LEFT JOIN hotel_rooms r ON r.hotel_id=h.id AND r.status='active' ${where.length?'WHERE '+where.join(' AND '):''} GROUP BY h.id ORDER BY h.star_rating DESC,h.created_at DESC LIMIT 100`,vals);
  let rows=r.rows;
  if(dateValid(ci,co)){ const filtered=[]; for(const h of rows){ const roomsR=(await pool.query(`SELECT * FROM hotel_rooms WHERE hotel_id=$1 AND status='active' AND max_guests >= $2`,[h.id,adults])).rows; let ok=false; for(const rm of roomsR){const av=await roomAvailability(rm.id,ci,co,rooms); if(av.ok){ok=true;break;}} if(ok) filtered.push(h);} rows=filtered; }
  res.json({data:rows});
}catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل الفنادق'});}});
app.get('/api/hotels/:id', async(req,res)=>{try{const h=(await pool.query(`SELECT * FROM hotels WHERE id=$1 AND status='active'`,[req.params.id])).rows[0];if(!h)return res.status(404).json({error:'الفندق غير موجود'});const rooms=(await pool.query(`SELECT * FROM hotel_rooms WHERE hotel_id=$1 AND status='active' ORDER BY price`,[h.id])).rows;res.json({hotel:h,rooms});}catch(e){res.status(500).json({error:'تعذر تحميل الفندق'});}});
app.post('/api/hotels/book', async(req,res)=>{try{
  const b=req.body||{}; if(b.payment_method && b.payment_method!=='pay_at_hotel')return res.status(400).json({error:'الدفع الإلكتروني للفنادق غير مفعّل حالياً. اختر الدفع عند الوصول.'}); if(!dateValid(b.check_in,b.check_out))return res.status(400).json({error:'تواريخ الحجز غير صحيحة'}); const adults=Math.max(1,Number(b.adults)||1), children=Math.max(0,Number(b.children)||0), roomsCount=Math.max(1,Number(b.rooms_count)||1);
  const h=(await pool.query(`SELECT * FROM hotels WHERE id=$1 AND status='active'`,[b.hotel_id])).rows[0]; if(!h)return res.status(404).json({error:'الفندق غير موجود'});
  const client=await pool.connect(); let av; try{await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock($1)',[Number(b.room_id)]); const room=(await client.query('SELECT * FROM hotel_rooms WHERE id=$1 FOR UPDATE',[b.room_id])).rows[0]; if(!room||Number(room.hotel_id)!==Number(h.id)||room.status!=='active'){await client.query('ROLLBACK');client.release();return res.status(404).json({error:'الغرفة غير موجودة'});} const booked=(await client.query(`SELECT COALESCE(SUM(rooms_count),0)::int n FROM hotel_bookings WHERE room_id=$1 AND status IN ('pending','confirmed') AND check_in < $3 AND check_out > $2`,[b.room_id,b.check_in,b.check_out])).rows[0].n; const blocked=(await client.query(`SELECT COALESCE(SUM(quantity),0)::int n FROM hotel_availability_blocks WHERE room_id=$1 AND start_date < $3 AND end_date > $2`,[b.room_id,b.check_in,b.check_out])).rows[0].n; const available=Math.max(0,Number(room.quantity)-Number(booked)-Number(blocked)); av={ok:available>=roomsCount,room,available}; if(!av.ok){await client.query('ROLLBACK');client.release();return res.status(409).json({error:`لا يوجد توفر كافٍ. المتاح حالياً: ${av.available}`});} if(Number(av.room.max_guests)<adults){await client.query('ROLLBACK');client.release();return res.status(400).json({error:'عدد الضيوف أكبر من سعة الغرفة'});}
  const rate=(await client.query(`SELECT price,currency FROM hotel_room_rates WHERE room_id=$1 AND start_date <= $2 AND end_date > $2 ORDER BY created_at DESC LIMIT 1`,[av.room.id,b.check_in])).rows[0]||{price:av.room.price,currency:av.room.currency}; const n=Math.ceil((new Date(b.check_out)-new Date(b.check_in))/86400000); const discount=Number((await client.query(`SELECT COALESCE(MAX(discount_percent),0) discount FROM hotel_promotions WHERE hotel_id=$1 AND active=TRUE AND start_date <= $2 AND end_date >= $3`,[h.id,b.check_in,b.check_out])).rows[0].discount||0); const subtotal=Number(rate.price)*n*roomsCount; const total=Number((subtotal*(1-discount/100)).toFixed(2)); const commissionRate=Number(h.platform_commission_rate||0); const commission=Number((total*commissionRate/100).toFixed(2)); const net=Number((total-commission).toFixed(2)); const code='AQH-'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase();
  const userId=(await getCurrentUser(req))?.id||null; const r=await client.query(`INSERT INTO hotel_bookings(booking_code,hotel_id,room_id,user_id,guest_name,guest_email,guest_phone,check_in,check_out,adults,children,rooms_count,nights,unit_price,subtotal,total,currency,payment_method,payment_status,status,cancellation_deadline,special_requests,commission_amount,net_amount,stay_terms_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'confirmed',(($8::date+$23::time) AT TIME ZONE 'Asia/Damascus')-($24::int*INTERVAL '1 hour'),$20,$21,$22,$25::jsonb) RETURNING *`,[code,h.id,av.room.id,userId,b.guest_name,b.guest_email||null,b.guest_phone,b.check_in,b.check_out,adults,children,roomsCount,n,rate.price,subtotal,total,rate.currency,b.payment_method||'pay_at_hotel',b.payment_method==='online'?'pending':'pending',b.special_requests||null,commission,net,require('./stay-policy').snapshot(h).check_in_time,require('./stay-policy').snapshot(h).free_cancel_hours,JSON.stringify(require('./stay-policy').snapshot(h))]);
  await client.query(`INSERT INTO hotel_booking_events(booking_id,event_type,note,actor_user_id) VALUES($1,'created','تم إنشاء الحجز', $2)`,[r.rows[0].id,userId]); const inv='AQHINV-'+Date.now().toString(36).toUpperCase(); await client.query(`INSERT INTO hotel_invoices(booking_id,invoice_number,gross_amount,commission_amount,net_amount,currency) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[r.rows[0].id,inv,total,commission,net,rate.currency]); await client.query('COMMIT'); client.release(); res.status(201).json({data:r.rows[0],invoice_number:inv}); syncHotel(pool,h.id).catch(e=>console.error('OTA post-booking sync',e.message));
}catch(e){try{await client.query('ROLLBACK')}catch(_){} client.release(); console.error(e);res.status(500).json({error:'تعذر إنشاء الحجز'});} }catch(e){console.error(e);res.status(500).json({error:'تعذر إنشاء الحجز'});}});

const hotelManualPayments=require('./hotel-manual-payments');
require('./mobile-hotels').register(app,{pool,getCurrentUser,syncHotel,manualPayments:hotelManualPayments.createService(pool)});
const qrUpload=multer({storage,limits:{fileSize:2*1024*1024},fileFilter:(_req,file,cb)=>cb(null,/^image\/(jpeg|png|webp)$/.test(file.mimetype))}).single('qr');
hotelManualPayments.register(app,{pool,requireAdmin,syncHotel,receiveQr:(req,res,next)=>qrUpload(req,res,error=>error?res.status(400).json({error:'تعذر رفع رمز QR. اختر صورة بحجم أقل من 2 ميغابايت.'}):next())});
require('./demo-hotels').register(app, { pool, requireAdmin });
require('./admin-permissions').register(app,{pool,requireAdmin,bcrypt,ownerEmail:process.env.ADMIN_EMAIL});
require('./hotel-media').register(app,{pool,requireOfficeMember,ownedHotel,uploadDir,createVideoPoster});
require('./host-portal').register(app,{pool,requireAuth,requireOfficeMember,ownedHotel});

app.get('/api/office/hotels',requireOfficeMember,async(req,res)=>{try{const hs=(await pool.query(`SELECT h.*,(SELECT COUNT(*) FROM hotel_rooms r WHERE r.hotel_id=h.id)::int room_types,(SELECT COUNT(*) FROM hotel_bookings b WHERE b.hotel_id=h.id AND b.status IN ('pending','confirmed'))::int open_bookings FROM hotels h WHERE (h.office_id=$1 OR h.owner_id=$2 OR $3::boolean) ORDER BY h.created_at DESC`,[req.office.id,req.office.owner_id,req.office.platform_admin===true])).rows;res.json({data:hs});}catch(e){res.status(500).json({error:'تعذر تحميل فنادق المكتب'});}});
app.post('/api/office/hotels',requireOfficeMember,async(req,res)=>{try{const b=req.body||{};if(!b.name||!b.city)return res.status(400).json({error:'اسم المنشأة والمدينة مطلوبان'});if([b.check_in_time,b.check_out_time].some(x=>x!=null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x))))return res.status(400).json({error:'أدخل موعد دخول وخروج صحيحًا'});if(b.lodging_type&&!require('./host-portal').types.includes(b.lodging_type))return res.status(400).json({error:'نوع المنشأة غير صحيح'});let slug=String(b.slug||b.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,220)||('hotel-'+Date.now());let base=slug,n=2;while((await pool.query('SELECT 1 FROM hotels WHERE slug=$1',[slug])).rows[0])slug=base+'-'+n++;const r=await pool.query(`INSERT INTO hotels(office_id,owner_id,name,slug,city,district,address,description,star_rating,latitude,longitude,amenities,images,check_in_time,check_out_time,cancellation_policy,status,lodging_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending',$17) RETURNING *`,[req.office.id,req.office.owner_id,b.name,slug,b.city,b.district||null,b.address||null,b.description||null,Number(b.star_rating)||0,b.latitude||null,b.longitude||null,JSON.stringify(b.amenities||[]),JSON.stringify(b.images||[]),b.check_in_time||'14:00',b.check_out_time||'12:00',b.cancellation_policy||null,b.lodging_type||'hotel']);res.status(201).json({data:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'تعذر إنشاء الفندق'});}});
app.patch('/api/office/hotels/:id',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const b=req.body||{};if([b.check_in_time,b.check_out_time].some(x=>x!=null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x))))return res.status(400).json({error:'أدخل موعد دخول وخروج صحيحًا'});const r=await pool.query(`UPDATE hotels SET name=COALESCE($1,name),city=COALESCE($2,city),district=COALESCE($3,district),address=COALESCE($4,address),description=COALESCE($5,description),star_rating=COALESCE($6,star_rating),check_in_time=COALESCE($7,check_in_time),check_out_time=COALESCE($8,check_out_time),cancellation_policy=COALESCE($9,cancellation_policy),terms_version=terms_version+1,updated_at=NOW() WHERE id=$10 RETURNING *`,[b.name||null,b.city||null,b.district||null,b.address||null,b.description||null,b.star_rating===undefined?null:Number(b.star_rating),b.check_in_time||null,b.check_out_time||null,b.cancellation_policy||null,req.params.id]);res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر تعديل الفندق'});}});
app.get('/api/office/hotels/:id/rooms',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=await pool.query(`SELECT * FROM hotel_rooms WHERE hotel_id=$1 ORDER BY created_at DESC`,[req.params.id]);res.json({data:r.rows});}catch(e){res.status(500).json({error:'تعذر تحميل الغرف'});}});
app.post('/api/office/hotels/:id/rooms',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const b=req.body||{};if(!b.name||!b.room_type)return res.status(400).json({error:'اسم الغرفة ونوعها مطلوبان'});const r=await pool.query(`INSERT INTO hotel_rooms(hotel_id,name,room_type,description,max_guests,bed_type,size_m2,price,currency,quantity,amenities,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[req.params.id,b.name,b.room_type,b.description||null,Math.max(1,Number(b.max_guests)||2),b.bed_type||null,b.size_m2||null,Number(b.price)||0,b.currency||'USD',Math.max(1,Number(b.quantity)||1),JSON.stringify(b.amenities||[]),b.status==='inactive'?'inactive':'active']);res.status(201).json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر إضافة الغرفة'});}});
app.patch('/api/office/hotel-rooms/:id',requireOfficeMember,async(req,res)=>{try{const r=await pool.query(`UPDATE hotel_rooms r SET name=COALESCE($1,r.name),room_type=COALESCE($2,r.room_type),description=COALESCE($3,r.description),max_guests=COALESCE($4,r.max_guests),bed_type=COALESCE($5,r.bed_type),size_m2=COALESCE($6,r.size_m2),price=COALESCE($7,r.price),currency=COALESCE($8,r.currency),quantity=COALESCE($9,r.quantity),status=COALESCE($10,r.status),updated_at=NOW() FROM hotels h WHERE r.id=$11 AND r.hotel_id=h.id AND (h.office_id=$12 OR h.owner_id=$13 OR $14::boolean) RETURNING r.*`,[req.body.name||null,req.body.room_type||null,req.body.description||null,req.body.max_guests===undefined?null:Number(req.body.max_guests),req.body.bed_type||null,req.body.size_m2===undefined?null:req.body.size_m2,req.body.price===undefined?null:Number(req.body.price),req.body.currency||null,req.body.quantity===undefined?null:Math.max(1,Number(req.body.quantity)),req.body.status||null,req.params.id,req.office.id,req.office.owner_id,req.office.platform_admin===true]);if(!r.rows[0])return res.status(404).json({error:'الغرفة غير موجودة'});res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر تعديل الغرفة'});}});
app.get('/api/office/hotels/:id/bookings',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=await pool.query(`SELECT b.*,r.name room_name FROM hotel_bookings b JOIN hotel_rooms r ON r.id=b.room_id WHERE b.hotel_id=$1 ORDER BY b.created_at DESC LIMIT 500`,[req.params.id]);res.json({data:r.rows});}catch(e){res.status(500).json({error:'تعذر تحميل الحجوزات'});}});
app.patch('/api/office/hotel-bookings/:id',requireOfficeMember,async(req,res)=>{try{const status=String(req.body.status||'');if(!['confirmed','cancelled','completed','no_show','pending'].includes(status))return res.status(400).json({error:'حالة الحجز غير صحيحة'});if(req.user.role==='user'&&!['cancelled','completed','no_show'].includes(status))return res.status(403).json({error:'تأكيد الدفع والحجوزات المعلقة متاح للإدارة فقط'});const r=await pool.query(`UPDATE hotel_bookings b SET status=$1,updated_at=NOW() FROM hotels h WHERE b.id=$2 AND b.hotel_id=h.id AND (h.office_id=$3 OR h.owner_id=$4 OR $5::boolean) AND (NOT $6::boolean OR (b.status IN ('pending','confirmed') AND ($1='cancelled' OR (b.status='confirmed' AND (($1='completed' AND b.check_out<(NOW() AT TIME ZONE 'Asia/Damascus')::date) OR ($1='no_show' AND b.check_in<(NOW() AT TIME ZONE 'Asia/Damascus')::date)))))) RETURNING b.*`,[status,req.params.id,req.office.id,req.office.owner_id,req.office.platform_admin===true,req.user.role==='user']);if(!r.rows[0])return res.status(404).json({error:'الحجز غير موجود'});await pool.query(`INSERT INTO hotel_booking_events(booking_id,event_type,note,actor_user_id) VALUES($1,$2,$3,$4)`,[r.rows[0].id,status,'تحديث حالة الحجز من لوحة الفندق',req.user?.id||null]); res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر تحديث الحجز'});}});
app.get('/api/office/hotels/:id/promotions',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=await pool.query(`SELECT * FROM hotel_promotions WHERE hotel_id=$1 ORDER BY start_date DESC`,[req.params.id]);res.json({data:r.rows});}catch(e){res.status(500).json({error:'تعذر تحميل العروض'});}});
app.post('/api/office/hotels/:id/promotions',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const b=req.body||{};if(!dateValid(b.start_date,b.end_date))return res.status(400).json({error:'تواريخ العرض غير صحيحة'});const r=await pool.query(`INSERT INTO hotel_promotions(hotel_id,name,start_date,end_date,discount_percent,active) VALUES($1,$2,$3,$4,$5,TRUE) RETURNING *`,[req.params.id,b.name,b.start_date,b.end_date,Math.min(100,Math.max(0,Number(b.discount_percent)||0))]);res.status(201).json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر إضافة العرض'});}});
app.delete('/api/office/hotel-promotions/:id',requireOfficeMember,async(req,res)=>{try{const r=await pool.query(`UPDATE hotel_promotions p SET active=FALSE FROM hotels h WHERE p.id=$1 AND p.hotel_id=h.id AND (h.office_id=$2 OR h.owner_id=$3 OR $4::boolean) RETURNING p.*`,[req.params.id,req.office.id,req.office.owner_id,req.office.platform_admin===true]);if(!r.rows[0])return res.status(404).json({error:'العرض غير موجود'});res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر إيقاف العرض'});}});
app.post('/api/office/hotel-rooms/:id/rates',requireOfficeMember,async(req,res)=>{try{const b=req.body||{};if(!dateValid(b.start_date,b.end_date))return res.status(400).json({error:'تواريخ السعر غير صحيحة'});const r=await pool.query(`INSERT INTO hotel_room_rates(room_id,start_date,end_date,price,currency,min_nights) SELECT r.id,$1,$2,$3,$4,$5 FROM hotel_rooms r JOIN hotels h ON h.id=r.hotel_id WHERE r.id=$6 AND (h.office_id=$7 OR h.owner_id=$8 OR $9::boolean) RETURNING *`,[b.start_date,b.end_date,Number(b.price)||0,b.currency||'USD',Math.max(1,Number(b.min_nights)||1),req.params.id,req.office.id,req.office.owner_id,req.office.platform_admin===true]);if(!r.rows[0])return res.status(404).json({error:'الغرفة غير موجودة'});res.status(201).json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر إضافة السعر الموسمي'});}});
app.post('/api/office/hotel-rooms/:id/blocks',requireOfficeMember,async(req,res)=>{try{const b=req.body||{};if(!dateValid(b.start_date,b.end_date))return res.status(400).json({error:'تواريخ الحجب غير صحيحة'});const r=await pool.query(`INSERT INTO hotel_availability_blocks(room_id,start_date,end_date,quantity,reason) SELECT r.id,$1,$2,$3,$4 FROM hotel_rooms r JOIN hotels h ON h.id=r.hotel_id WHERE r.id=$5 AND (h.office_id=$6 OR h.owner_id=$7 OR $8::boolean) RETURNING *`,[b.start_date,b.end_date,Math.max(1,Number(b.quantity)||1),b.reason||null,req.params.id,req.office.id,req.office.owner_id,req.office.platform_admin===true]);if(!r.rows[0])return res.status(404).json({error:'الغرفة غير موجودة'});res.status(201).json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر حجب التوفر'});}});


// ---------------- V24 Full OTA Hotel Onboarding ----------------
const OTA_PROVIDERS=['booking','agoda','expedia'];
async function ensureOnboarding(hotelId,provider,externalHotelId=null){
  const r=await pool.query(`INSERT INTO hotel_channel_onboardings(hotel_id,provider,external_hotel_id) VALUES($1,$2,$3) ON CONFLICT(hotel_id,provider) DO UPDATE SET external_hotel_id=COALESCE(EXCLUDED.external_hotel_id,hotel_channel_onboardings.external_hotel_id),updated_at=NOW() RETURNING *`,[hotelId,provider,externalHotelId]);
  return r.rows[0];
}
async function onboardingReview(hotelId,provider){
  const local=(await pool.query(`SELECT id,name,room_type,max_guests FROM hotel_rooms WHERE hotel_id=$1 AND status='active' ORDER BY id`,[hotelId])).rows;
  const cat=(await pool.query(`SELECT * FROM hotel_channel_catalog WHERE hotel_id=$1 AND provider=$2 ORDER BY external_room_id,external_rate_plan_id`,[hotelId,provider])).rows;
  const sug=await getMappingSuggestions(pool,hotelId,provider);
  const mappedExternal=new Set(sug.filter(x=>x.mapped).map(x=>`${x.external_room_id}|${x.external_rate_plan_id}`));
  const localMapped=new Set((await pool.query(`SELECT DISTINCT room_id FROM hotel_channel_mappings WHERE hotel_id=$1 AND provider=$2 AND is_active=TRUE`,[hotelId,provider])).rows.map(x=>String(x.room_id)));
  const duplicateExternal=(await pool.query(`SELECT external_room_id,external_rate_plan_id,COUNT(*)::int count FROM hotel_channel_mappings WHERE hotel_id=$1 AND provider=$2 AND is_active=TRUE GROUP BY external_room_id,external_rate_plan_id HAVING COUNT(*)>1`,[hotelId,provider])).rows;
  const warnings=[];
  for(const r of local) if(!localMapped.has(String(r.id))) warnings.push({type:'unmapped_local_room',room_id:r.id,room_name:r.name});
  for(const x of cat) if(!mappedExternal.has(`${x.external_room_id}|${x.external_rate_plan_id}`)) warnings.push({type:'unmapped_external_rate',external_room_id:x.external_room_id,external_rate_plan_id:x.external_rate_plan_id,room_name:x.room_name,rate_plan_name:x.rate_plan_name});
  for(const x of duplicateExternal) warnings.push({type:'duplicate_external_mapping',...x});
  const confident=sug.filter(x=>!x.mapped&&x.suggested_room_id&&x.confidence>=80).length;
  return {local_rooms:local,catalog:cat,suggestions:sug,warnings,confident,complete:cat.length>0 && warnings.filter(w=>w.type!=='unmapped_external_rate').length===0};
}
app.get('/api/office/hotels/:id/ota-onboarding',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const rows=(await pool.query(`SELECT * FROM hotel_channel_onboardings WHERE hotel_id=$1 ORDER BY provider`,[req.params.id])).rows;const out=[];for(const p of OTA_PROVIDERS){const o=rows.find(x=>x.provider===p)||await ensureOnboarding(Number(req.params.id),p,null);out.push(o);}res.json({data:out});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/office/hotels/:id/ota-onboarding/:provider/test',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const p=String(req.params.provider).toLowerCase();if(!OTA_PROVIDERS.includes(p))return res.status(400).json({error:'القناة غير مدعومة'});const o=await ensureOnboarding(Number(req.params.id),p,req.body?.external_hotel_id||null);const x=await testConnection(pool,Number(req.params.id),p,req.body?.external_hotel_id||o.external_hotel_id);await pool.query(`UPDATE hotel_channel_onboardings SET external_hotel_id=$1,credentials_ok=TRUE,property_ok=TRUE,status='connected',last_error=NULL,last_result=$2,updated_at=NOW() WHERE id=$3`,[x.external_hotel_id,JSON.stringify(x),o.id]);res.json(x);}catch(e){const p=String(req.params.provider).toLowerCase();await pool.query(`UPDATE hotel_channel_onboardings SET credentials_ok=FALSE,property_ok=FALSE,status='error',last_error=$1,updated_at=NOW() WHERE hotel_id=$2 AND provider=$3`,[String(e.message).slice(0,1000),req.params.id,p]).catch(()=>{});res.status(502).json({error:'فشل اختبار الاتصال: '+e.message});}});
app.post('/api/office/hotels/:id/ota-onboarding/:provider/discover',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const p=String(req.params.provider).toLowerCase();if(!OTA_PROVIDERS.includes(p))return res.status(400).json({error:'القناة غير مدعومة'});const o=await ensureOnboarding(Number(req.params.id),p,req.body?.external_hotel_id||null);const rows=await discoverCatalog(pool,Number(req.params.id),p,req.body?.external_hotel_id||o.external_hotel_id);const review=await onboardingReview(Number(req.params.id),p);await pool.query(`UPDATE hotel_channel_onboardings SET external_hotel_id=$1,credentials_ok=TRUE,property_ok=TRUE,catalog_ok=TRUE,discovered_count=$2,warning_count=$3,status='catalog_ready',last_error=NULL,last_result=$4,updated_at=NOW() WHERE id=$5`,[req.body?.external_hotel_id||o.external_hotel_id,rows.length,review.warnings.length,JSON.stringify({discovered:rows.length}),o.id]);res.json({provider:p,discovered:rows.length,review});}catch(e){res.status(502).json({error:'تعذر اكتشاف بيانات الفندق: '+e.message});}});
app.get('/api/office/hotels/:id/ota-onboarding/:provider/review',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const p=String(req.params.provider).toLowerCase();if(!OTA_PROVIDERS.includes(p))return res.status(400).json({error:'القناة غير مدعومة'});const review=await onboardingReview(Number(req.params.id),p);const o=(await pool.query(`SELECT * FROM hotel_channel_onboardings WHERE hotel_id=$1 AND provider=$2`,[req.params.id,p])).rows[0]||null;res.json({onboarding:o,review});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/office/hotels/:id/ota-onboarding/:provider/approve',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});if(req.body?.confirmed!==true)return res.status(400).json({error:'يجب تأكيد مراجعة المطابقة قبل التفعيل'});const p=String(req.params.provider).toLowerCase();if(!OTA_PROVIDERS.includes(p))return res.status(400).json({error:'القناة غير مدعومة'});const hotelId=Number(req.params.id);const o=(await pool.query(`SELECT * FROM hotel_channel_onboardings WHERE hotel_id=$1 AND provider=$2`,[hotelId,p])).rows[0];if(!o?.catalog_ok)return res.status(409).json({error:'يجب اختبار الاتصال واكتشاف الغرف والأسعار أولاً'});const review=await onboardingReview(hotelId,p);if(review.warnings.some(w=>w.type==='duplicate_external_mapping'))return res.status(409).json({error:'يوجد ربط خارجي مكرر',warnings:review.warnings});const threshold=Math.max(50,Math.min(100,Number(req.body.threshold)||80));const selected=Array.isArray(req.body.mapping_ids)?new Set(req.body.mapping_ids.map(String)):null;let mapped=0;for(const x of review.suggestions){if(x.mapped)continue;if(!x.suggested_room_id||x.confidence<threshold)continue;if(selected && !selected.has(`${x.external_room_id}|${x.external_rate_plan_id}`))continue;await pool.query(`INSERT INTO hotel_channel_mappings(hotel_id,room_id,provider,external_hotel_id,external_room_id,external_rate_plan_id,is_active) VALUES($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT(provider,external_hotel_id,external_room_id,external_rate_plan_id) DO UPDATE SET room_id=EXCLUDED.room_id,hotel_id=EXCLUDED.hotel_id,is_active=TRUE,updated_at=NOW()`,[hotelId,x.suggested_room_id,p,x.external_hotel_id,x.external_room_id,x.external_rate_plan_id]);mapped++;}
  const after=await onboardingReview(hotelId,p); if(after.warnings.some(w=>w.type==='unmapped_local_room') && req.body.require_all_rooms===true)return res.status(409).json({error:'هناك غرف محلية غير مربوطة',review:after});
  const run=(await pool.query(`INSERT INTO hotel_channel_onboarding_runs(onboarding_id,status,current_step,total_items) VALUES($1,'running','initial_sync',1) RETURNING id`,[o.id])).rows[0].id;
  await pool.query(`UPDATE hotel_channel_onboardings SET mappings_ok=TRUE,mapped_count=$1,status='syncing',last_error=NULL,updated_at=NOW() WHERE id=$2`,[mapped+after.suggestions.filter(x=>x.mapped).length,o.id]);
  res.status(202).json({accepted:true,run_id:run,mapped});
  syncInitial365(pool,hotelId,p,{onProgress:async(done,total,last)=>{await pool.query(`UPDATE hotel_channel_onboarding_runs SET total_items=$1,completed_items=$2,current_step=$3 WHERE id=$4`,[total,done,last?.status||'syncing',run]);}}).then(async result=>{await pool.query(`UPDATE hotel_channel_onboarding_runs SET status=$1,current_step='done',completed_items=$2,total_items=$3,failed_items=$4,finished_at=NOW() WHERE id=$5`,[result.failed?'partial':'success',result.completed,result.total,result.failed,run]);await pool.query(`UPDATE hotel_channel_onboardings SET initial_sync_ok=$1,status=$2,last_result=$3,updated_at=NOW() WHERE id=$4`,[result.failed===0,result.failed?'partial':'active',JSON.stringify(result),o.id]);}).catch(async e=>{await pool.query(`UPDATE hotel_channel_onboarding_runs SET status='error',error_message=$1,finished_at=NOW() WHERE id=$2`,[String(e.message).slice(0,1000),run]);await pool.query(`UPDATE hotel_channel_onboardings SET status='error',last_error=$1,updated_at=NOW() WHERE id=$2`,[String(e.message).slice(0,1000),o.id]);});
}catch(e){res.status(500).json({error:'تعذر اعتماد القناة: '+e.message});}});
app.get('/api/office/hotels/:id/ota-onboarding/runs/:runId',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=(await pool.query(`SELECT r.* FROM hotel_channel_onboarding_runs r JOIN hotel_channel_onboardings o ON o.id=r.onboarding_id WHERE r.id=$1 AND o.hotel_id=$2`,[req.params.runId,req.params.id])).rows[0];if(!r)return res.status(404).json({error:'عملية المزامنة غير موجودة'});res.json({data:r});}catch(e){res.status(500).json({error:e.message});}});

// ---------------- V22 Official OTA Channel Manager ----------------
app.get('/api/office/hotels/:id/channels',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const [m,r]=await Promise.all([pool.query(`SELECT * FROM hotel_channel_mappings WHERE hotel_id=$1 ORDER BY provider,id`,[req.params.id]),pool.query(`SELECT id,'all'::text AS provider,run_type,status,started_at,finished_at,sent_count,failed_count,error_message FROM hotel_channel_sync_runs WHERE hotel_id=$1 ORDER BY started_at DESC LIMIT 30`,[req.params.id])]);res.json({data:m.rows,runs:r.rows});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/office/hotels/:id/channels/mappings',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const b=req.body||{};if(!['booking','agoda','expedia'].includes(b.provider)||!b.room_id||!b.external_hotel_id||!b.external_room_id||!b.external_rate_plan_id)return res.status(400).json({error:'بيانات ربط القناة غير مكتملة'});const r=await pool.query(`INSERT INTO hotel_channel_mappings(hotel_id,room_id,provider,external_hotel_id,external_room_id,external_rate_plan_id,is_active) VALUES($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT(provider,external_hotel_id,external_room_id,external_rate_plan_id) DO UPDATE SET room_id=EXCLUDED.room_id,hotel_id=EXCLUDED.hotel_id,is_active=TRUE,updated_at=NOW() RETURNING *`,[req.params.id,b.room_id,b.provider,b.external_hotel_id,b.external_room_id,b.external_rate_plan_id]);res.status(201).json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر حفظ ربط القناة: '+e.message});}});
app.patch('/api/office/hotel-channel-mappings/:id',requireOfficeMember,async(req,res)=>{try{const r=await pool.query(`UPDATE hotel_channel_mappings m SET is_active=COALESCE($1,m.is_active),updated_at=NOW() FROM hotels h WHERE m.id=$2 AND m.hotel_id=h.id AND (h.office_id=$3 OR h.owner_id=$4 OR $5::boolean) RETURNING m.*`,[req.body.is_active===undefined?null:!!req.body.is_active,req.params.id,req.office.id,req.office.owner_id,req.office.platform_admin===true]);if(!r.rows[0])return res.status(404).json({error:'الربط غير موجود'});res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/office/hotels/:id/channels/sync',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const x=await syncHotel(pool,Number(req.params.id),{from:req.body?.from,to:req.body?.to});res.json(x);}catch(e){res.status(502).json({error:'فشل مزامنة القنوات: '+e.message});}});
app.get('/api/hotel-channel/webhooks/:provider',async(req,res)=>{res.status(200).json({ok:true,provider:req.params.provider,challenge:req.query.challenge||null});});
app.post('/api/hotel-channel/webhooks/:provider',async(req,res)=>{try{const provider=String(req.params.provider).toLowerCase();if(!['booking','agoda','expedia'].includes(provider))return res.status(404).end();const body=req.body;let events=[];if(typeof body==='string'){events=[body];}else{const p=body||{};events=Array.isArray(p.events)?p.events:[p];}const out=[];for(const e of events){const result=await ingestExternalBooking(pool,provider,e);out.push(result);}res.status(200).type('application/json').send(JSON.stringify({ok:true,processed:out.length,results:out}));}catch(e){console.error('OTA webhook',e);res.status(500).json({ok:false,error:e.message});}});
app.post('/api/office/hotels/:id/channels/reservations/sync',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const hotelId=Number(req.params.id);const providers=Array.isArray(req.body?.providers)&&req.body.providers.length?req.body.providers:['booking','agoda','expedia'];const results=[];for(const provider of providers){if(!['booking','agoda','expedia'].includes(provider))continue;const run=(await pool.query(`INSERT INTO hotel_channel_reservation_runs(hotel_id,provider,status) VALUES($1,$2,'running') RETURNING id`,[hotelId,provider])).rows[0].id;try{const hotel=await ownedHotel(hotelId,req.office);const ext=hotel[`${provider}_hotel_id`]||null;const x=await fetchExternalReservations(pool,provider,ext,{sinceMinutes:Number(req.body?.since_minutes)||30});await pool.query(`UPDATE hotel_channel_reservation_runs SET status='success',processed_count=$1,finished_at=NOW() WHERE id=$2`,[x.processed||0,run]);results.push({...x,run_id:run});}catch(e){await pool.query(`UPDATE hotel_channel_reservation_runs SET status='error',last_error=$1,finished_at=NOW() WHERE id=$2`,[String(e.message).slice(0,1000),run]);results.push({provider,run_id:run,error:e.message});}}res.json({results});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/office/hotels/:id/channels/reservations/runs',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=await pool.query(`SELECT * FROM hotel_channel_reservation_runs WHERE hotel_id=$1 ORDER BY started_at DESC LIMIT 50`,[req.params.id]);res.json({data:r.rows});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/office/hotels/:id/channels/external-reservations',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=await pool.query(`SELECT er.*,b.booking_code,b.check_in,b.check_out,b.guest_name,r.name room_name FROM hotel_external_reservations er LEFT JOIN hotel_bookings b ON b.id=er.local_booking_id LEFT JOIN hotel_rooms r ON r.id=er.room_id WHERE er.hotel_id=$1 ORDER BY er.updated_at DESC LIMIT 100`,[req.params.id]);res.json({data:r.rows});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/office/hotels/:id/channels/discover/:provider',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const p=String(req.params.provider).toLowerCase();if(!['booking','agoda','expedia'].includes(p))return res.status(400).json({error:'القناة غير مدعومة'});const hotel=await ownedHotel(req.params.id,req.office);const rows=await discoverCatalog(pool,Number(req.params.id),p,req.body?.external_hotel_id||hotel[`${p}_hotel_id`]);const suggestions=await getMappingSuggestions(pool,Number(req.params.id),p);res.json({provider:p,discovered:rows.length,suggestions});}catch(e){console.error(e);res.status(502).json({error:'تعذر اكتشاف غرف القناة: '+e.message});}});
app.get('/api/office/hotels/:id/channels/suggestions/:provider',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});res.json({data:await getMappingSuggestions(pool,Number(req.params.id),String(req.params.provider).toLowerCase())});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/office/hotels/:id/channels/auto-map/:provider',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const p=String(req.params.provider).toLowerCase();const suggestions=await getMappingSuggestions(pool,Number(req.params.id),p);const threshold=Math.max(50,Math.min(100,Number(req.body?.threshold)||80));let mapped=0;for(const x of suggestions.filter(x=>!x.mapped&&x.suggested_room_id&&x.confidence>=threshold)){await pool.query(`INSERT INTO hotel_channel_mappings(hotel_id,room_id,provider,external_hotel_id,external_room_id,external_rate_plan_id,is_active) VALUES($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT(provider,external_hotel_id,external_room_id,external_rate_plan_id) DO UPDATE SET room_id=EXCLUDED.room_id,hotel_id=EXCLUDED.hotel_id,is_active=TRUE,updated_at=NOW()`,[req.params.id,x.suggested_room_id,p,x.external_hotel_id,x.external_room_id,x.external_rate_plan_id]);mapped++;}res.json({provider:p,mapped,threshold});}catch(e){res.status(500).json({error:'تعذر تنفيذ الربط التلقائي: '+e.message});}});
app.post('/api/office/hotels/:id/channels/map',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const b=req.body||{};if(!b.provider||!b.room_id||!b.external_hotel_id||!b.external_room_id||!b.external_rate_plan_id)return res.status(400).json({error:'بيانات الربط ناقصة'});const r=await pool.query(`INSERT INTO hotel_channel_mappings(hotel_id,room_id,provider,external_hotel_id,external_room_id,external_rate_plan_id,is_active) VALUES($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT(provider,external_hotel_id,external_room_id,external_rate_plan_id) DO UPDATE SET room_id=EXCLUDED.room_id,hotel_id=EXCLUDED.hotel_id,is_active=TRUE,updated_at=NOW() RETURNING *`,[req.params.id,b.room_id,b.provider,b.external_hotel_id,b.external_room_id,b.external_rate_plan_id]);res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/office/hotels/:id/channels/mappings',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=await pool.query(`SELECT m.*,r.name room_name FROM hotel_channel_mappings m JOIN hotel_rooms r ON r.id=m.room_id WHERE m.hotel_id=$1 ORDER BY m.provider,m.id`,[req.params.id]);res.json({data:r.rows});}catch(e){res.status(500).json({error:e.message});}});
setTimeout(()=>{pool.query('SELECT DISTINCT hotel_id FROM hotel_channel_mappings WHERE is_active=TRUE').then(async q=>{for(const x of q.rows)syncHotel(pool,x.hotel_id).catch(e=>console.error('OTA sync',x.hotel_id,e.message));}).catch(e=>console.error('OTA bootstrap',e.message));},20000);
setInterval(()=>{pool.query('SELECT DISTINCT hotel_id FROM hotel_channel_mappings WHERE is_active=TRUE').then(async q=>{for(const x of q.rows)syncHotel(pool,x.hotel_id).catch(e=>console.error('OTA sync',x.hotel_id,e.message));}).catch(e=>console.error('OTA interval',e.message));},Math.max(5,Number(process.env.OTA_SYNC_INTERVAL_MINUTES||15))*60000);
setInterval(()=>{pool.query('SELECT DISTINCT hotel_id FROM hotel_channel_mappings WHERE is_active=TRUE').then(async q=>{for(const x of q.rows){for(const provider of ['booking','agoda','expedia']){const hotel=(pool.query(`SELECT * FROM hotels WHERE id=$1`,[x.hotel_id]).then(r=>r.rows[0]));hotel.then(h=>fetchExternalReservations(pool,provider,h?.[`${provider}_hotel_id`],{sinceMinutes:Math.max(10,Number(process.env.OTA_RESERVATION_POLL_MINUTES||2))}).catch(e=>{if(!/not configured|required|No active/i.test(e.message))console.error('OTA reservation poll',x.hotel_id,provider,e.message)}));}}}).catch(e=>console.error('OTA reservation scheduler',e.message));},Math.max(1,Number(process.env.OTA_RESERVATION_POLL_MINUTES||2))*60000);

// ---------------- V26 OTA financial reconciliation ----------------
async function upsertOtaFinancial(pool, hotelId, provider, externalBookingId, data){
  const d=data||{}; const vals=[provider,hotelId,String(externalBookingId),d.local_booking_id||null,d.currency||'USD',Number(d.gross_amount||0),Number(d.commission_amount||0),Number(d.charges_amount||0),Number(d.taxes_amount||0),Number(d.payout_amount||0),Number(d.amount_to_collect||0),d.payout_status||'unknown',d.payment_method||null,JSON.stringify(d.raw||d)];
  const q=await pool.query(`INSERT INTO hotel_ota_financials(provider,hotel_id,external_booking_id,local_booking_id,currency,gross_amount,commission_amount,charges_amount,taxes_amount,payout_amount,amount_to_collect,payout_status,payment_method,source_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(provider,external_booking_id) DO UPDATE SET local_booking_id=EXCLUDED.local_booking_id,currency=EXCLUDED.currency,gross_amount=EXCLUDED.gross_amount,commission_amount=EXCLUDED.commission_amount,charges_amount=EXCLUDED.charges_amount,taxes_amount=EXCLUDED.taxes_amount,payout_amount=EXCLUDED.payout_amount,amount_to_collect=EXCLUDED.amount_to_collect,payout_status=EXCLUDED.payout_status,payment_method=EXCLUDED.payment_method,source_payload=EXCLUDED.source_payload,last_synced_at=NOW(),updated_at=NOW() RETURNING *`,vals);
  return q.rows[0];
}
async function fetchBookingPayout(pool, hotelId, externalBookingId, localBookingId){
  const token=process.env.BOOKING_API_TOKEN; if(!token) throw new Error('BOOKING_API_TOKEN is required');
  const base=process.env.BOOKING_PAYMENTS_API_BASE_URL||'https://payments-api.booking.com';
  const r=await fetch(`${base}/connectivity-payments/reservations/${encodeURIComponent(externalBookingId)}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json','accept-version':'1.1'}});
  const t=await r.text(); let j={}; try{j=t?JSON.parse(t):{} }catch(_){j={raw:t}} if(!r.ok)throw new Error(`Booking Payments ${r.status}: ${t.slice(0,500)}`);
  const money=v=>Number(v?.value||v||0); const commissions=money(j.commissions_and_charges?.value||j.commissions_and_charges); const payout=money(j.total_payout); const collect=money(j.total_amount_to_collect_at_property); const gross=money(j.commissionable_price);
  const out=await upsertOtaFinancial(pool,hotelId,'booking',externalBookingId,{local_booking_id:localBookingId,currency:j.total_payout?.currency||j.commissionable_price?.currency||'USD',gross_amount:gross,commission_amount:commissions,charges_amount:money(j.commissions_and_charges?.breakdown?.total_charges),taxes_amount:0,payout_amount:payout,amount_to_collect:collect,payout_status:j.payout_status||j.status||'unknown',payment_method:j.payout_type||null,raw:j});
  await pool.query(`INSERT INTO hotel_ota_financial_events(hotel_id,provider,external_booking_id,event_type,amount,currency,payload) VALUES($1,'booking',$2,'payout_synced',$3,$4,$5)`,[hotelId,externalBookingId,payout,out.currency,JSON.stringify(j)]); return out;
}
async function fetchAgodaFinancial(pool,hotelId,externalBookingId,localBookingId){
  const key=process.env.AGODA_API_KEY;if(!key)throw new Error('AGODA_API_KEY is required');
  const url=process.env.AGODA_FINANCIAL_URL; if(!url) throw new Error('AGODA_FINANCIAL_URL must be configured from Agoda YCS contract');
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({propertyId:process.env.AGODA_HOTEL_ID,bookingId:externalBookingId,apiKey:key})}); const t=await r.text(); let j={};try{j=t?JSON.parse(t):{}}catch(_){j={raw:t}} if(!r.ok)throw new Error(`Agoda financial ${r.status}: ${t.slice(0,500)}`);
  const num=(...xs)=>{for(const x of xs){if(x!==undefined&&x!==null&&!isNaN(Number(x)))return Number(x)}return 0}; const out=await upsertOtaFinancial(pool,hotelId,'agoda',externalBookingId,{local_booking_id:localBookingId,currency:j.currency||'USD',gross_amount:num(j.grossAmount,j.totalAmount,j.total),commission_amount:num(j.commission,j.commissionAmount),charges_amount:num(j.charges,j.fees),taxes_amount:num(j.taxes,j.tax),payout_amount:num(j.payoutAmount,j.netAmount,j.net),amount_to_collect:num(j.amountToCollect),payout_status:j.payoutStatus||j.status||'unknown',payment_method:j.paymentMethod,raw:j}); return out;
}
async function fetchExpediaFinancial(pool,hotelId,externalBookingId,localBookingId){
  const url=process.env.EXPEDIA_FINANCIAL_URL;if(!url)throw new Error('EXPEDIA_FINANCIAL_URL must be configured from the approved Expedia Connectivity contract'); const token=process.env.EXPEDIA_API_TOKEN;if(!token)throw new Error('EXPEDIA_API_TOKEN is required');
  const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({propertyId:process.env.EXPEDIA_HOTEL_ID,bookingId:externalBookingId})});const t=await r.text();let j={};try{j=t?JSON.parse(t):{}}catch(_){j={raw:t}}if(!r.ok)throw new Error(`Expedia financial ${r.status}: ${t.slice(0,500)}`);
  const num=(...xs)=>{for(const x of xs){if(x!==undefined&&x!==null&&!isNaN(Number(x)))return Number(x)}return 0};return upsertOtaFinancial(pool,hotelId,'expedia',externalBookingId,{local_booking_id:localBookingId,currency:j.currency||'USD',gross_amount:num(j.grossAmount,j.totalAmount,j.total),commission_amount:num(j.commission,j.commissionAmount),charges_amount:num(j.charges,j.fees),taxes_amount:num(j.taxes,j.tax),payout_amount:num(j.payoutAmount,j.netAmount,j.net),amount_to_collect:num(j.amountToCollect),payout_status:j.payoutStatus||j.status||'unknown',payment_method:j.paymentMethod,raw:j});
}
app.get('/api/office/hotels/:id/ota-finance',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const id=Number(req.params.id);const summary=(await pool.query(`SELECT COUNT(*)::int entries,COALESCE(SUM(gross_amount),0) gross,COALESCE(SUM(commission_amount),0) commission,COALESCE(SUM(charges_amount),0) charges,COALESCE(SUM(taxes_amount),0) taxes,COALESCE(SUM(payout_amount),0) payout,COALESCE(SUM(amount_to_collect),0) to_collect FROM hotel_ota_financials WHERE hotel_id=$1`,[id])).rows[0];const byProvider=(await pool.query(`SELECT provider,currency,COUNT(*)::int entries,COALESCE(SUM(gross_amount),0) gross,COALESCE(SUM(commission_amount),0) commission,COALESCE(SUM(charges_amount),0) charges,COALESCE(SUM(taxes_amount),0) taxes,COALESCE(SUM(payout_amount),0) payout,COALESCE(SUM(amount_to_collect),0) to_collect FROM hotel_ota_financials WHERE hotel_id=$1 GROUP BY provider,currency ORDER BY provider,currency`,[id])).rows;const rows=(await pool.query(`SELECT f.*,b.booking_code,b.guest_name,b.check_in,b.check_out FROM hotel_ota_financials f LEFT JOIN hotel_bookings b ON b.id=f.local_booking_id WHERE f.hotel_id=$1 ORDER BY f.updated_at DESC LIMIT 200`,[id])).rows;res.json({summary,by_provider:byProvider,data:rows});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/office/hotels/:id/ota-finance/sync',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const id=Number(req.params.id);const p=req.body?.provider&&String(req.body.provider).toLowerCase();const q=p?[p]:['booking','agoda','expedia'];const ext=(await pool.query(`SELECT provider,external_booking_id,local_booking_id FROM hotel_external_reservations WHERE hotel_id=$1 AND provider=ANY($2::text[]) ORDER BY updated_at DESC LIMIT 500`,[id,q])).rows;const results=[];for(const x of ext){try{let r;if(x.provider==='booking')r=await fetchBookingPayout(pool,id,x.external_booking_id,x.local_booking_id);else if(x.provider==='agoda')r=await fetchAgodaFinancial(pool,id,x.external_booking_id,x.local_booking_id);else r=await fetchExpediaFinancial(pool,id,x.external_booking_id,x.local_booking_id);results.push({provider:x.provider,external_booking_id:x.external_booking_id,ok:true,data:r});}catch(e){results.push({provider:x.provider,external_booking_id:x.external_booking_id,ok:false,error:e.message});}}res.json({processed:results.length,results});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/office/hotels/:id/ota-finance/settlement',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const id=Number(req.params.id);const from=String(req.body?.from||new Date(Date.now()-30*86400000).toISOString().slice(0,10));const to=String(req.body?.to||new Date().toISOString().slice(0,10));const provider=String(req.body?.provider||'booking').toLowerCase();const rows=(await pool.query(`SELECT currency,COALESCE(SUM(gross_amount),0) gross_amount,COALESCE(SUM(commission_amount),0) commission_amount,COALESCE(SUM(charges_amount),0) charges_amount,COALESCE(SUM(taxes_amount),0) taxes_amount,COALESCE(SUM(payout_amount),0) payout_amount,COALESCE(SUM(amount_to_collect),0) amount_to_collect FROM hotel_ota_financials WHERE hotel_id=$1 AND provider=$2 AND updated_at::date BETWEEN $3::date AND $4::date GROUP BY currency`,[id,provider,from,to])).rows;for(const x of rows){await pool.query(`INSERT INTO hotel_ota_settlements(hotel_id,provider,period_start,period_end,currency,gross_amount,commission_amount,charges_amount,taxes_amount,payout_amount,amount_to_collect,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open') ON CONFLICT(hotel_id,provider,period_start,period_end,currency) DO UPDATE SET gross_amount=EXCLUDED.gross_amount,commission_amount=EXCLUDED.commission_amount,charges_amount=EXCLUDED.charges_amount,taxes_amount=EXCLUDED.taxes_amount,payout_amount=EXCLUDED.payout_amount,amount_to_collect=EXCLUDED.amount_to_collect,updated_at=NOW()`,[id,provider,from,to,x.currency,x.gross_amount,x.commission_amount,x.charges_amount,x.taxes_amount,x.payout_amount,x.amount_to_collect]);}res.json({from,to,provider,data:rows});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/office/hotels/:id/ota-finance/settlements',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=await pool.query(`SELECT * FROM hotel_ota_settlements WHERE hotel_id=$1 ORDER BY period_end DESC,provider`,[req.params.id]);res.json({data:r.rows});}catch(e){res.status(500).json({error:e.message});}});
app.patch('/api/office/hotels/:id/ota-finance/settlements/:sid',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const status=['open','matched','paid','disputed'].includes(req.body?.status)?req.body.status:'open';const r=await pool.query(`UPDATE hotel_ota_settlements SET status=$1,notes=COALESCE($2,notes),updated_at=NOW() WHERE id=$3 AND hotel_id=$4 RETURNING *`,[status,req.body?.notes||null,req.params.sid,req.params.id]);if(!r.rows[0])return res.status(404).json({error:'التسوية غير موجودة'});res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:e.message});}});

// ---------------- V39 advanced geographic search ----------------
function pointInPolygon(lat,lng,poly){
  if(!Array.isArray(poly)||poly.length<3)return true; let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const yi=Number(poly[i][0]),xi=Number(poly[i][1]),yj=Number(poly[j][0]),xj=Number(poly[j][1]);
    const hit=((yi>lat)!=(yj>lat))&&(lng<(xj-xi)*(lat-yi)/((yj-yi)||1e-12)+xi); if(hit)inside=!inside;
  } return inside;
}
function haversineKm(a,b,c,d){const R=6371,toRad=x=>Number(x)*Math.PI/180;const dLat=toRad(c-a),dLng=toRad(d-b);const q=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(Math.min(1,q)));}
app.post('/api/properties/geo-search',async(req,res)=>{try{
  const b=req.body||{}, poly=Array.isArray(b.polygon)?b.polygon.slice(0,100):null, center=b.center||{}, radius=Math.min(200,Math.max(0,Number(b.radiusKm)||0));
  const vals=[];const where=["p.status='active'","p.is_demo=FALSE"];
  if(b.office||b.availability==='sold')where.push('FALSE');
  const add=(sql,v)=>{vals.push(v);where.push(sql.replace('?',`$${vals.length}`));};
  if(b.city)add('p.city=?',b.city);if(b.district)add('p.district=?',String(b.district).trim());if(b.type)add('p.type=?',b.type);if(b.mode)add('p.mode=?',b.mode);if(b.rooms&&b.rooms!=='5+')add('p.rooms=?',Number(b.rooms));if(b.rooms==='5+')where.push('p.rooms>=5');
  if(b.minPrice)add('p.price>=?',Number(b.minPrice));if(b.maxPrice)add('p.price<=?',Number(b.maxPrice));
  const r=await pool.query(`SELECT p.id,p.title,p.is_demo,p.type,p.mode,p.city,p.district,p.price,p.currency,p.area,p.rooms,p.baths,p.image_url,p.featured,p.latitude,p.longitude,p.created_at FROM properties p WHERE ${where.join(' AND ')} ORDER BY p.featured DESC,p.created_at DESC LIMIT 500`,vals);
  const imported=await require('./office-search').searchOfficeMapListings(pool,b,getFxRate);
  const owned=r.rows.map(require('./listing-location').withFallbackLocation);
  let data=[...owned,...imported].filter(x=>x.latitude!=null&&x.longitude!=null&&(!poly||pointInPolygon(Number(x.latitude),Number(x.longitude),poly)));
  if(Number.isFinite(Number(center.lat))&&Number.isFinite(Number(center.lng))&&radius)data=data.filter(x=>haversineKm(center.lat,center.lng,x.latitude,x.longitude)<=radius);
  const speed={drive:35,walk:4.5,bike:15}[b.commuteMode]||35, minutes=Math.max(0,Number(b.commuteMinutes)||0);
  if(minutes&&Number.isFinite(Number(center.lat))&&Number.isFinite(Number(center.lng))){const maxKm=speed*minutes/60;data=data.filter(x=>!x.location_approximate&&haversineKm(center.lat,center.lng,x.latitude,x.longitude)<=maxKm).map(x=>({...x,commute_estimate_minutes:Math.round(haversineKm(center.lat,center.lng,x.latitude,x.longitude)/speed*60)}));}
  res.json({data,count:data.length,approximate_commute:minutes>0,approximate_locations:data.some(x=>x.location_approximate)});
}catch(e){console.error(e);res.status(500).json({error:'تعذر تنفيذ البحث الجغرافي المتقدم'});}});
app.get('/api/me/search-areas',requireAuth,async(req,res)=>{try{const r=await pool.query('SELECT * FROM property_search_areas WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]);res.json({data:r.rows});}catch(e){res.status(500).json({error:'تعذر تحميل مناطق البحث'});}});
app.post('/api/me/search-areas',requireAuth,async(req,res)=>{try{const b=req.body||{};const r=await pool.query(`INSERT INTO property_search_areas(user_id,name,polygon,center_lat,center_lng,radius_km,commute_minutes,commute_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[req.user.id,String(b.name||'منطقة بحث').slice(0,160),JSON.stringify(b.polygon||null),b.center?.lat||null,b.center?.lng||null,b.radiusKm||null,b.commuteMinutes||null,b.commuteMode||null]);res.status(201).json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر حفظ منطقة البحث'});}});

// ---------------- Saved searches & alerts ----------------
function buildSavedSearchFilters(body){
  const allowed=['mode','city','district','type','minPrice','maxPrice','rooms','lat','lng','radiusKm','q','currency','polygon','commuteMinutes','commuteMode'];
  const out={};
  for(const k of allowed){
    if(body[k]!==undefined && body[k]!==null && String(body[k]).trim()!=='') out[k]=body[k];
  }
  return out;
}
app.get('/api/me/saved-searches', requireAuth, async (req,res)=>{
  try{
    const r=await pool.query(`SELECT s.*, (SELECT COUNT(*) FROM user_notifications n WHERE n.saved_search_id=s.id AND n.is_read=FALSE)::int unread_count FROM saved_searches s WHERE s.user_id=$1 ORDER BY s.updated_at DESC`,[req.user.id]);
    res.json({data:r.rows});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل عمليات البحث المحفوظة'});}
});
app.post('/api/me/saved-searches', requireAuth, async (req,res)=>{
  try{
    const filters=buildSavedSearchFilters(req.body||{});
    const name=String(req.body.name||'بحث محفوظ').trim().slice(0,160);
    const currency=String(req.body.currency||filters.currency||'USD').toUpperCase().slice(0,10);
    const channels=normalizeChannels(req.body.notification_channels);
    const r=await pool.query(`INSERT INTO saved_searches(user_id,name,filters,currency,notification_channels) VALUES($1,$2,$3,$4,$5) RETURNING *`,[req.user.id,name,JSON.stringify(filters),currency,JSON.stringify(channels)]);
    res.status(201).json({data:r.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر حفظ البحث'});}
});
app.patch('/api/me/saved-searches/:id', requireAuth, async (req,res)=>{
  try{
    const id=Number(req.params.id); const fields=[]; const vals=[id,req.user.id];
    if(req.body.name!==undefined){vals.push(String(req.body.name).trim().slice(0,160));fields.push(`name=$${vals.length}`);}
    if(req.body.alerts_enabled!==undefined){vals.push(Boolean(req.body.alerts_enabled));fields.push(`alerts_enabled=$${vals.length}`);}
    if(req.body.notification_channels!==undefined){vals.push(JSON.stringify(normalizeChannels(req.body.notification_channels)));fields.push(`notification_channels=$${vals.length}`);}
    if(req.body.filters!==undefined){vals.push(JSON.stringify(buildSavedSearchFilters(req.body.filters||{})));fields.push(`filters=$${vals.length}`);}
    if(!fields.length)return res.status(400).json({error:'لا توجد تعديلات'});
    fields.push('updated_at=NOW()');
    const r=await pool.query(`UPDATE saved_searches SET ${fields.join(',')} WHERE id=$1 AND user_id=$2 RETURNING *`,vals);
    if(!r.rows[0])return res.status(404).json({error:'البحث المحفوظ غير موجود'});
    res.json({data:r.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تعديل البحث'});}
});
app.delete('/api/me/saved-searches/:id', requireAuth, async (req,res)=>{
  try{const r=await pool.query('DELETE FROM saved_searches WHERE id=$1 AND user_id=$2 RETURNING id',[Number(req.params.id),req.user.id]);if(!r.rows[0])return res.status(404).json({error:'البحث المحفوظ غير موجود'});res.json({ok:true});}catch(e){res.status(500).json({error:'تعذر حذف البحث'});}
});
app.get('/api/me/notifications', requireAuth, async (req,res)=>{
  try{const r=await pool.query(`SELECT n.*,p.title property_title FROM user_notifications n LEFT JOIN properties p ON p.id=n.property_id WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 100`,[req.user.id]);res.json({data:r.rows,unread:r.rows.filter(x=>!x.is_read).length});}catch(e){res.status(500).json({error:'تعذر تحميل التنبيهات'});}
});
app.post('/api/me/notifications/read', requireAuth, async (req,res)=>{
  try{const id=req.body.id?Number(req.body.id):null;if(id)await pool.query('UPDATE user_notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2',[id,req.user.id]);else await pool.query('UPDATE user_notifications SET is_read=TRUE WHERE user_id=$1',[req.user.id]);res.json({ok:true});}catch(e){res.status(500).json({error:'تعذر تحديث التنبيهات'});}
});
async function notifySavedSearchMatches(property){
  try{
    const searches=await pool.query(`SELECT * FROM saved_searches WHERE alerts_enabled=TRUE`);
    for(const s of searches.rows){
      const f=s.filters||{}; let ok=true;
      if(f.mode && String(property.mode)!==String(f.mode)) ok=false;
      if(f.city && String(property.city)!==String(f.city)) ok=false;
      if(f.district && String(property.district||'')!==String(f.district)) ok=false;
      if(f.type && String(property.type)!==String(f.type)) ok=false;
      if(f.rooms && Number(property.rooms||0)<Number(f.rooms)) ok=false;
      let comparePrice=Number(property.price||0);
      const targetCurrency=String(f.currency||property.currency||'USD').toUpperCase();
      const propertyCurrency=String(property.currency||'USD').toUpperCase();
      if(targetCurrency!==propertyCurrency){try{comparePrice=comparePrice*await getFxRate(propertyCurrency,targetCurrency)}catch{ok=false;}}
      if(f.minPrice && comparePrice<Number(f.minPrice)) ok=false;
      if(f.maxPrice && comparePrice>Number(f.maxPrice)) ok=false;
      if(f.lat && f.lng && property.latitude!=null && property.longitude!=null){
        const R=6371, toRad=x=>Number(x)*Math.PI/180; const dLat=toRad(Number(property.latitude)-Number(f.lat)); const dLng=toRad(Number(property.longitude)-Number(f.lng));
        const a=Math.sin(dLat/2)**2+Math.cos(toRad(Number(f.lat)))*Math.cos(toRad(Number(property.latitude)))*Math.sin(dLng/2)**2; const distance=2*R*Math.asin(Math.sqrt(Math.max(0,Math.min(1,a))));
        if(f.radiusKm && distance>Number(f.radiusKm)) ok=false;
      } else if(f.lat && f.lng && f.radiusKm) ok=false;
      if(f.q){const q=String(f.q).toLowerCase();const hay=`${property.title||''} ${property.city||''} ${property.district||''} ${property.description||''}`.toLowerCase();if(!hay.includes(q))ok=false;}
      if(ok && Number(s.user_id)!==Number(property.owner_id)){
        await dispatchSavedSearchNotification(s,property);
        await pool.query('UPDATE saved_searches SET last_checked_at=NOW() WHERE id=$1',[s.id]);
      }
    }
  }catch(e){console.error('saved search notify error',e);}
}


// Notification channel configuration / push registration
app.get('/api/me/notification-config', requireAuth, async (req,res)=>res.json({data:{...notificationConfig(),vapidPublicKey:process.env.VAPID_PUBLIC_KEY||null},channels:DEFAULT_CHANNELS}));
app.get('/api/me/push/public-key', requireAuth, async (_req,res)=>{if(!process.env.VAPID_PUBLIC_KEY)return res.status(503).json({error:'Push غير مهيأ'});res.json({publicKey:process.env.VAPID_PUBLIC_KEY});});
app.post('/api/me/push/subscribe', requireAuth, async (req,res)=>{try{const s=req.body.subscription||req.body;if(!s.endpoint||!s.keys?.p256dh||!s.keys?.auth)return res.status(400).json({error:'اشتراك Push غير صالح'});await pool.query(`INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,updated_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(user_id,endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,user_agent=EXCLUDED.user_agent,updated_at=NOW()`,[req.user.id,s.endpoint,s.keys.p256dh,s.keys.auth,req.headers['user-agent']||null]);res.json({ok:true});}catch(e){console.error(e);res.status(500).json({error:'تعذر تسجيل إشعارات الهاتف'});}});
app.delete('/api/me/push/subscribe', requireAuth, async (req,res)=>{try{await pool.query('DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2',[req.user.id,req.body.endpoint]);res.json({ok:true});}catch(e){res.status(500).json({error:'تعذر إلغاء إشعارات الهاتف'});}});
app.get('/api/me/notification-deliveries', requireAuth, async (req,res)=>{try{const r=await pool.query(`SELECT d.*,s.name search_name,p.title property_title FROM notification_deliveries d LEFT JOIN saved_searches s ON s.id=d.saved_search_id LEFT JOIN properties p ON p.id=d.property_id WHERE d.user_id=$1 ORDER BY d.created_at DESC LIMIT 100`,[req.user.id]);res.json({data:r.rows});}catch(e){res.status(500).json({error:'تعذر تحميل سجل الإرسال'});}});

// ---------------- Notification setup / diagnostics ----------------
app.get('/api/admin/notifications/status', requireAdmin, async (_req,res)=>{
  res.json({data:{...notificationConfig(),appUrl:process.env.APP_URL||null,smtpHost:process.env.SMTP_HOST||null,whatsappPhoneId:process.env.WHATSAPP_PHONE_NUMBER_ID?true:false,vapidPublicKey:process.env.VAPID_PUBLIC_KEY||null}});
});
app.post('/api/admin/notifications/test', requireAdmin, async (req,res)=>{
  const channel=String(req.body.channel||'').toLowerCase();
  const title=String(req.body.title||'اختبار تنبيهات عقارتكم').slice(0,180);
  const body=String(req.body.body||'تم إرسال هذا التنبيه من لوحة إدارة عقارتكم.').slice(0,1000);
  const admin=req.user;
  try{
    if(channel==='email'){await sendEmailNotification(admin,title,body,null);}
    else if(channel==='push'){await sendPushNotification(admin.id,title,body,null);}
    else if(channel==='whatsapp'){await sendWhatsAppNotification(admin,title,body,null);}
    else if(channel==='in_app'){await pool.query(`INSERT INTO user_notifications(user_id,type,title,body) VALUES($1,'system_test',$2,$3)`,[admin.id,title,body]);}
    else return res.status(400).json({error:'قناة غير مدعومة'});
    res.json({ok:true,message:'تم إرسال اختبار القناة بنجاح'});
  }catch(e){res.status(400).json({error:e.message||'فشل الاختبار'});}
});

// ---------------- Advanced real-estate office system ----------------
app.get('/api/office/dashboard', requireOfficeMember, async (req,res)=>{
  try{
    const oid=req.office.id;
    const [stats, stages, props, leads, appointments, deals, staff]=await Promise.all([
      pool.query(`SELECT (SELECT COUNT(*) FROM properties WHERE office_id=$1) properties,(SELECT COUNT(*) FROM properties WHERE office_id=$1 AND status='active') active_properties,(SELECT COUNT(*) FROM office_leads WHERE office_id=$1) leads,(SELECT COUNT(*) FROM office_leads WHERE office_id=$1 AND stage NOT IN ('won','lost')) open_leads,(SELECT COUNT(*) FROM office_appointments WHERE office_id=$1 AND starts_at>=NOW() AND starts_at<NOW()+INTERVAL '30 days') appointments,(SELECT COUNT(*) FROM office_deals WHERE office_id=$1 AND status='completed') completed_deals,(SELECT COALESCE(SUM(amount),0) FROM office_deals WHERE office_id=$1 AND status='completed') deal_value,(SELECT COALESCE(SUM(office_commission),0) FROM office_deals WHERE office_id=$1 AND status='completed') commission`,[oid]),
      pool.query(`SELECT stage,COUNT(*)::int count FROM office_leads WHERE office_id=$1 GROUP BY stage ORDER BY stage`,[oid]),
      pool.query(`SELECT p.id,p.title,p.mode,p.city,p.district,p.price,p.image_url,p.status,p.featured,p.views_count,p.assigned_to,u.name assigned_name,(SELECT COUNT(*) FROM inquiries i WHERE i.property_id=p.id) inquiries FROM properties p LEFT JOIN users u ON u.id=p.assigned_to WHERE p.office_id=$1 ORDER BY p.created_at DESC LIMIT 20`,[oid]),
      pool.query(`SELECT l.*,p.title property_title,u.name assigned_name FROM office_leads l LEFT JOIN properties p ON p.id=l.property_id LEFT JOIN users u ON u.id=l.assigned_to WHERE l.office_id=$1 ORDER BY l.created_at DESC LIMIT 30`,[oid]),
      pool.query(`SELECT a.*,l.name lead_name,p.title property_title,u.name assigned_name FROM office_appointments a LEFT JOIN office_leads l ON l.id=a.lead_id LEFT JOIN properties p ON p.id=a.property_id LEFT JOIN users u ON u.id=a.assigned_to WHERE a.office_id=$1 AND a.starts_at>=NOW()-INTERVAL '1 day' ORDER BY a.starts_at ASC LIMIT 30`,[oid]),
      pool.query(`SELECT d.*,l.name lead_name,p.title property_title,u.name agent_name FROM office_deals d LEFT JOIN office_leads l ON l.id=d.lead_id LEFT JOIN properties p ON p.id=d.property_id LEFT JOIN users u ON u.id=d.agent_id WHERE d.office_id=$1 ORDER BY d.created_at DESC LIMIT 30`,[oid]),
      pool.query(`SELECT id,name,email,phone,role,office_title,is_active,created_at,(SELECT COUNT(*) FROM properties p WHERE p.assigned_to=users.id AND p.office_id=$1)::int properties_count,(SELECT COUNT(*) FROM office_leads l WHERE l.assigned_to=users.id AND l.office_id=$1)::int leads_count FROM users WHERE office_id=$1 ORDER BY created_at DESC`,[oid])
    ]);
    res.json({office:req.office,stats:stats.rows[0],lead_stages:stages.rows,properties:props.rows,leads:leads.rows,appointments:appointments.rows,deals:deals.rows,staff:staff.rows});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل لوحة المكتب'});}
});

app.post('/api/office', requireOffice, async (req,res)=>{
  try{
    const {name,phone,whatsapp,city,district,address,description}=req.body;
    if(!String(name||'').trim()) return res.status(400).json({error:'اسم المكتب مطلوب'});
    const existing=await getOfficeForUser(req.user.id); if(existing) return res.status(409).json({error:'لديك مكتب مرتبط بالفعل'});
    let slug=officeSlug(name); const conflict=await pool.query('SELECT id FROM offices WHERE slug=$1',[slug]); if(conflict.rows[0]) slug=`${slug}-${Date.now()}`;
    const r=await pool.query(`INSERT INTO offices(owner_id,name,slug,phone,whatsapp,city,district,address,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[req.user.id,String(name).trim(),slug,phone||null,whatsapp||null,city||null,district||null,address||null,description||null]);
    await pool.query('UPDATE users SET office_id=$1, office_title=\'مدير المكتب\', role=CASE WHEN role=\'user\' THEN \'agent\' ELSE role END, updated_at=NOW() WHERE id=$2',[r.rows[0].id,req.user.id]);
    res.status(201).json({data:r.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر إنشاء المكتب'});}
});

app.patch('/api/office', requireOfficeMember, async (req,res)=>{
  try{ const fields=['name','phone','whatsapp','city','district','address','description','logo_url']; const vals=[]; const sets=[]; for(const f of fields){if(req.body[f]!==undefined){vals.push(req.body[f]||null);sets.push(`${f}=$${vals.length}`)}} if(!sets.length)return res.json({data:req.office}); vals.push(req.office.id); const r=await pool.query(`UPDATE offices SET ${sets.join(',')},updated_at=NOW() WHERE id=$${vals.length} RETURNING *`,vals); res.json({data:r.rows[0]}); }
  catch(e){console.error(e);res.status(500).json({error:'تعذر تحديث بيانات المكتب'});}
});

app.post('/api/office/staff', requireOfficeMember, async (req,res)=>{
  try{
    if(Number(req.office.owner_id)!==Number(req.user.id)) return res.status(403).json({error:'إضافة الموظفين متاحة لمدير المكتب فقط'});
    const {name,email,phone,password,office_title='مسوق عقاري',role='agent'}=req.body;
    if(!name||!validEmail(normalizeEmail(email))||String(password||'').length<8)return res.status(400).json({error:'الاسم والبريد وكلمة المرور (8 أحرف) مطلوبة'});
    const ex=await pool.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)',[normalizeEmail(email)]); if(ex.rows[0])return res.status(409).json({error:'البريد مستخدم مسبقاً'});
    const sub=await officeSubscription(req.office.id); if(sub){ const count=(await pool.query('SELECT COUNT(*)::int count FROM users WHERE office_id=$1',[req.office.id])).rows[0].count; if(sub.max_staff>=0 && count>=sub.max_staff)return res.status(403).json({error:`الباقة تسمح بـ ${sub.max_staff} موظفين فقط`}); }
    const hash=await bcrypt.hash(String(password),12); const r=await pool.query(`INSERT INTO users(name,email,phone,password_hash,role,office_id,office_title) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,email,phone,role,office_title,is_active,created_at`,[name,normalizeEmail(email),phone||null,hash,role==='agent'?'agent':'agent',req.office.id,office_title]);
    res.status(201).json({data:r.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر إضافة الموظف'});}
});
app.patch('/api/office/staff/:id', requireOfficeMember, async(req,res)=>{
  try{ if(Number(req.office.owner_id)!==Number(req.user.id))return res.status(403).json({error:'غير مصرح'}); const {is_active,office_title}=req.body; const r=await pool.query(`UPDATE users SET is_active=COALESCE($1,is_active),office_title=COALESCE($2,office_title),updated_at=NOW() WHERE id=$3 AND office_id=$4 RETURNING id,name,email,phone,role,office_title,is_active`,[typeof is_active==='boolean'?is_active:null,office_title||null,req.params.id,req.office.id]); if(!r.rows[0])return res.status(404).json({error:'الموظف غير موجود'});res.json({data:r.rows[0]}); }catch(e){console.error(e);res.status(500).json({error:'تعذر تعديل الموظف'});}
});

app.post('/api/office/leads', requireOfficeMember, async(req,res)=>{
  try{ const b=req.body; if(!b.name)return res.status(400).json({error:'اسم العميل مطلوب'}); const r=await pool.query(`INSERT INTO office_leads(office_id,assigned_to,property_id,name,phone,email,budget,interest_type,interest_mode,city,district,source,stage,notes,next_follow_up) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[req.office.id,b.assigned_to||req.user.id,b.property_id||null,b.name,b.phone||null,b.email||null,b.budget||null,b.interest_type||null,b.interest_mode||null,b.city||null,b.district||null,b.source||'manual',b.stage||'new',b.notes||null,b.next_follow_up||null]); res.status(201).json({data:r.rows[0]}); }
  catch(e){console.error(e);res.status(500).json({error:'تعذر إضافة العميل'});}
});
app.patch('/api/office/leads/:id', requireOfficeMember, async(req,res)=>{ try{const allowed=['assigned_to','property_id','stage','notes','next_follow_up','budget','interest_type','interest_mode','city','district'];const vals=[];const sets=[];for(const f of allowed){if(req.body[f]!==undefined){vals.push(req.body[f]=== ''?null:req.body[f]);sets.push(`${f}=$${vals.length}`)}}if(!sets.length)return res.status(400).json({error:'لا توجد تغييرات'});vals.push(req.params.id,req.office.id);const r=await pool.query(`UPDATE office_leads SET ${sets.join(',')},updated_at=NOW() WHERE id=$${vals.length-1} AND office_id=$${vals.length} RETURNING *`,vals);if(!r.rows[0])return res.status(404).json({error:'العميل غير موجود'});res.json({data:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'تعذر تحديث العميل'});}});

app.post('/api/office/appointments', requireOfficeMember, async(req,res)=>{try{const b=req.body;if(!b.starts_at)return res.status(400).json({error:'موعد البداية مطلوب'});const r=await pool.query(`INSERT INTO office_appointments(office_id,lead_id,property_id,assigned_to,starts_at,ends_at,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[req.office.id,b.lead_id||null,b.property_id||null,b.assigned_to||req.user.id,b.starts_at,b.ends_at||null,b.status||'scheduled',b.notes||null]);res.status(201).json({data:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'تعذر إنشاء الموعد'});}});
app.patch('/api/office/appointments/:id', requireOfficeMember, async(req,res)=>{try{const r=await pool.query(`UPDATE office_appointments SET status=COALESCE($1,status),starts_at=COALESCE($2,starts_at),ends_at=COALESCE($3,ends_at),notes=COALESCE($4,notes) WHERE id=$5 AND office_id=$6 RETURNING *`,[req.body.status||null,req.body.starts_at||null,req.body.ends_at||null,req.body.notes||null,req.params.id,req.office.id]);if(!r.rows[0])return res.status(404).json({error:'الموعد غير موجود'});res.json({data:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'تعذر تعديل الموعد'});}});

app.post('/api/office/deals', requireOfficeMember, async(req,res)=>{try{const b=req.body;if(!b.amount||!b.mode)return res.status(400).json({error:'قيمة الصفقة ونوعها مطلوبان'});const amount=Number(b.amount);const rate=b.mode==='بيع'?1:3;const platformCommission=Number((amount*rate/100).toFixed(2));const r=await pool.query(`INSERT INTO office_deals(office_id,lead_id,property_id,agent_id,mode,amount,office_commission,agent_commission,platform_commission_rate,platform_commission,commission_payer,status,closed_at,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'seller',$11,$12,$13) RETURNING *`,[req.office.id,b.lead_id||null,b.property_id||null,b.agent_id||req.user.id,b.mode,amount,b.office_commission||0,b.agent_commission||0,rate,platformCommission,b.status||'negotiation',b.closed_at||null,b.notes||null]);res.status(201).json({data:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'تعذر تسجيل الصفقة'});}});
app.patch('/api/office/deals/:id', requireOfficeMember, async(req,res)=>{try{const r=await pool.query(`UPDATE office_deals SET status=COALESCE($1,status),office_commission=COALESCE($2,office_commission),agent_commission=COALESCE($3,agent_commission),closed_at=COALESCE($4,closed_at),notes=COALESCE($5,notes) WHERE id=$6 AND office_id=$7 RETURNING *`,[req.body.status||null,req.body.office_commission===undefined?null:req.body.office_commission,req.body.agent_commission===undefined?null:req.body.agent_commission,req.body.closed_at||null,req.body.notes||null,req.params.id,req.office.id]);if(!r.rows[0])return res.status(404).json({error:'الصفقة غير موجودة'});res.json({data:r.rows[0]});}catch(e){console.error(e);res.status(500).json({error:'تعذر تحديث الصفقة'});}});

app.get('/api/office/report', requireOfficeMember, async(req,res)=>{try{const oid=req.office.id;const [monthly,agents,top]=await Promise.all([pool.query(`SELECT TO_CHAR(date_trunc('month',created_at),'YYYY-MM') AS "month",COUNT(*) deals,COALESCE(SUM(amount),0) value,COALESCE(SUM(office_commission),0) commission FROM office_deals WHERE office_id=$1 AND status='completed' AND created_at>=NOW()-INTERVAL '12 months' GROUP BY 1 ORDER BY 1`,[oid]),pool.query(`SELECT u.name,COUNT(DISTINCT p.id)::int properties,COUNT(DISTINCT l.id)::int leads,COUNT(DISTINCT d.id)::int deals,COALESCE(SUM(d.amount),0) deal_value FROM users u LEFT JOIN properties p ON p.assigned_to=u.id AND p.office_id=$1 LEFT JOIN office_leads l ON l.assigned_to=u.id AND l.office_id=$1 LEFT JOIN office_deals d ON d.agent_id=u.id AND d.office_id=$1 AND d.status='completed' WHERE u.office_id=$1 GROUP BY u.id ORDER BY deal_value DESC`,[oid]),pool.query(`SELECT p.id,p.title,p.views_count,COUNT(i.id)::int inquiries FROM properties p LEFT JOIN inquiries i ON i.property_id=p.id WHERE p.office_id=$1 GROUP BY p.id ORDER BY p.views_count DESC LIMIT 10`,[oid])]);res.json({monthly:monthly.rows,agents:agents.rows,top_properties:top.rows});}catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل التقرير'});}});


// ---------------- Office growth: plans, billing, ads, verification, public profile ----------------
app.get('/api/office/plans', async (_req,res)=>{
  try { const r=await pool.query(`SELECT * FROM office_plans WHERE is_active=TRUE ORDER BY sort_order,price`); res.json({data:r.rows}); }
  catch(e){ console.error(e); res.status(500).json({error:'تعذر تحميل الباقات'}); }
});

async function officeSubscription(officeId){
  const r=await pool.query(`SELECT s.*,p.name plan_name,p.slug,p.price,p.currency,p.billing_period,p.max_properties,p.max_staff,p.max_featured,p.max_ads,p.verified_included,p.priority_support,p.features FROM office_subscriptions s JOIN office_plans p ON p.id=s.plan_id WHERE s.office_id=$1 AND s.status='active' AND (s.ends_at IS NULL OR s.ends_at>NOW()) ORDER BY s.ends_at DESC NULLS LAST LIMIT 1`,[officeId]);
  return r.rows[0]||null;
}
app.get('/api/office/billing', requireOfficeMember, async(req,res)=>{
  try{
    const [sub,plans,payments]=await Promise.all([
      officeSubscription(req.office.id),
      pool.query(`SELECT * FROM office_plans WHERE is_active=TRUE ORDER BY sort_order,price`),
      pool.query(`SELECT id,amount,currency,status,provider,provider_payment_id,checkout_url,created_at,paid_at FROM payments WHERE office_id=$1 ORDER BY created_at DESC LIMIT 30`,[req.office.id])
    ]);
    res.json({subscription:sub,plans:plans.rows,payments:payments.rows});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل الفوترة'});}
});

function paymentProvider(){ return String(process.env.PAYMENT_PROVIDER||'mock').toLowerCase(); }
function minorUnitFactor(currency){ const c=String(currency||'').toUpperCase(); return ['BHD','JOD','KWD','OMR','TND'].includes(c)?1000:['JPY','KRW'].includes(c)?1:100; }
function paymentAmountMinor(amount,currency){ return Math.round(Number(amount)*minorUnitFactor(currency)); }
function publicAppUrl(req){ return String(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/,''); }
async function moyasarFetchPayment(providerPaymentId){
  if(!process.env.MOYASAR_SECRET_KEY) throw new Error('MOYASAR_SECRET_KEY_missing');
  const r=await fetch(`https://api.moyasar.com/v1/payments/${encodeURIComponent(providerPaymentId)}`,{headers:{Authorization:`Basic ${Buffer.from(`${process.env.MOYASAR_SECRET_KEY}:`).toString('base64')}`}});
  const body=await r.json().catch(()=>({})); if(!r.ok) throw new Error(body.message||`Moyasar HTTP ${r.status}`); return body;
}
function newFinanceInvoiceNo(){ return `AQ-F-${new Date().getFullYear()}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

const finalizePaidPayment = require('./payment-settlement')({pool, newFinanceInvoiceNo});
const shamCash = require('./shamcash');

const FX_CACHE_TTL_MS=Number(process.env.FX_CACHE_TTL_MS||3600000);
const FX_PROVIDER_URL=String(process.env.FX_PROVIDER_URL||'https://open.er-api.com/v6/latest/USD');
const FX_BASE_CURRENCY=String(process.env.FX_BASE_CURRENCY||'USD').toUpperCase();
const FX_SUPPORTED=['USD','EUR','GBP','SAR','AED','CAD','AUD','JPY','CHF','SGD','KWD','QAR','BHD','OMR','JOD','SYP'];
async function refreshFxRates(){
  try{
    const r=await fetch(FX_PROVIDER_URL,{headers:{Accept:'application/json'}}); const body=await r.json().catch(()=>({}));
    if(!r.ok || body.result==='error' || !body.rates) throw new Error(body['error-type']||`FX HTTP ${r.status}`);
    const base=String(body.base_code||FX_BASE_CURRENCY).toUpperCase();
    const client=await pool.connect();
    try{await client.query('BEGIN');
      for(const cur of FX_SUPPORTED){ if(cur===base) {await client.query(`INSERT INTO currency_rates(base_currency,quote_currency,rate,source,fetched_at) VALUES($1,$2,1,$3,NOW()) ON CONFLICT(base_currency,quote_currency) DO UPDATE SET rate=1,source=$3,fetched_at=NOW()`,[base,cur,'auto']); continue;}
        const rate=Number(body.rates[cur]); if(Number.isFinite(rate)&&rate>0) await client.query(`INSERT INTO currency_rates(base_currency,quote_currency,rate,source,fetched_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(base_currency,quote_currency) DO UPDATE SET rate=EXCLUDED.rate,source=EXCLUDED.source,fetched_at=NOW()`,[base,cur,rate,'auto']);
      }
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    return true;
  }catch(e){console.error('FX refresh failed:',e.message);return false}
}
async function ensureFxRates(){
  const r=await pool.query(`SELECT MAX(fetched_at) max_at FROM currency_rates WHERE base_currency=$1`,[FX_BASE_CURRENCY]);
  if(!r.rows[0]?.max_at || Date.now()-new Date(r.rows[0].max_at).getTime()>FX_CACHE_TTL_MS) await refreshFxRates();
}
async function getFxRate(from,to){
  from=String(from||'USD').toUpperCase(); to=String(to||'USD').toUpperCase(); if(from===to)return 1;
  await ensureFxRates();
  if(from===FX_BASE_CURRENCY){const r=await pool.query(`SELECT rate FROM currency_rates WHERE base_currency=$1 AND quote_currency=$2`,[from,to]); if(r.rows[0])return Number(r.rows[0].rate)}
  if(to===FX_BASE_CURRENCY){const r=await pool.query(`SELECT rate FROM currency_rates WHERE base_currency=$1 AND quote_currency=$2`,[to,from]); if(r.rows[0])return 1/Number(r.rows[0].rate)}
  const a=await pool.query(`SELECT rate FROM currency_rates WHERE base_currency=$1 AND quote_currency=$2`,[FX_BASE_CURRENCY,from]);
  const b=await pool.query(`SELECT rate FROM currency_rates WHERE base_currency=$1 AND quote_currency=$2`,[FX_BASE_CURRENCY,to]);
  if(a.rows[0]&&b.rows[0]) return Number(b.rows[0].rate)/Number(a.rows[0].rate);
  throw new Error('FX_RATE_UNAVAILABLE');
}
app.get('/api/fx/rates', async(req,res)=>{try{const base=String(req.query.base||FX_BASE_CURRENCY).toUpperCase();const targets=String(req.query.targets||FX_SUPPORTED.join(',')).split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);await ensureFxRates();const out={base,rates:{},updated_at:null};for(const cur of targets){try{out.rates[cur]=await getFxRate(base,cur)}catch{}}const m=await pool.query(`SELECT MAX(fetched_at) fetched_at FROM currency_rates WHERE base_currency=$1`,[FX_BASE_CURRENCY]);out.updated_at=m.rows[0]?.fetched_at||null;res.json(out)}catch(e){res.status(503).json({error:'تعذر الحصول على أسعار الصرف حالياً'})}});
app.get('/api/fx/convert', async(req,res)=>{try{const amount=Number(req.query.amount),from=String(req.query.from||'USD').toUpperCase(),to=String(req.query.to||'USD').toUpperCase();if(!Number.isFinite(amount))return res.status(400).json({error:'المبلغ غير صالح'});const rate=await getFxRate(from,to);res.json({amount,from,to,rate,converted:Math.round(amount*rate*100)/100})}catch(e){res.status(503).json({error:'سعر الصرف غير متاح حالياً'})}});

const COUNTRY_CURRENCY={SY:'SYP',SA:'SAR',AE:'AED',KW:'KWD',QA:'QAR',BH:'BHD',OM:'OMR',JO:'JOD',US:'USD',CA:'CAD',GB:'GBP',AU:'AUD',JP:'JPY',CH:'CHF',SG:'SGD',DE:'EUR',FR:'EUR',IT:'EUR',ES:'EUR',NL:'EUR',BE:'EUR',AT:'EUR',IE:'EUR'};
const CURRENCY_META={SYP:{name:'الليرة السورية',countries:['SY']},SAR:{name:'الريال السعودي',countries:['SA']},AED:{name:'الدرهم الإماراتي',countries:['AE']},KWD:{name:'الدينار الكويتي',countries:['KW']},QAR:{name:'الريال القطري',countries:['QA']},BHD:{name:'الدينار البحريني',countries:['BH']},OMR:{name:'الريال العماني',countries:['OM']},JOD:{name:'الدينار الأردني',countries:['JO']},USD:{name:'الدولار الأمريكي',countries:['US']},CAD:{name:'الدولار الكندي',countries:['CA']},GBP:{name:'الجنيه الإسترليني',countries:['GB']},AUD:{name:'الدولار الأسترالي',countries:['AU']},JPY:{name:'الين الياباني',countries:['JP']},CHF:{name:'الفرنك السويسري',countries:['CH']},SGD:{name:'الدولار السنغافوري',countries:['SG']},EUR:{name:'اليورو',countries:['DE','FR','IT','ES','NL','BE','AT','IE']}};
function supportedGlobalCurrency(currency){ return ['USD','EUR','GBP','SAR','AED','CAD','AUD','JPY','CHF','SGD','KWD','QAR','BHD','OMR','JOD'].includes(String(currency||'').toUpperCase()); }
function configuredProvider(provider){const x=String(provider||'').toLowerCase(); if(x==='stripe')return !!process.env.STRIPE_SECRET_KEY; if(x==='paypal')return !!(process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET); if(x==='moyasar')return !!process.env.MOYASAR_PUBLISHABLE_KEY; if(x==='shamcash')return shamCash.isConfigured(); if(x==='syriatel_cash')return !!process.env.SYRIATEL_CASH_ACCOUNT; return x==='mock' && !isProduction;}
function paymentOptions(country,currency){
  const cc=String(country||'').toUpperCase(); const cur=String(currency||COUNTRY_CURRENCY[cc]||'USD').toUpperCase(); const out=[];
  const add=(id,name,icon,why)=>{if(configuredProvider(id))out.push({id,name,icon,reason:why});};
  if(cur==='SYP'){add('shamcash','شام كاش','💰','تحويل محلي بالليرة السورية');add('syriatel_cash','سيرياتيل كاش','📱','تحويل محلي بالليرة السورية');}
  if(cur==='SAR'){add('moyasar','Moyasar','💳','بطاقات ومدى ومحافظ رقمية');}
  if(supportedGlobalCurrency(cur)){add('stripe','Stripe','💳','بطاقات وApple Pay وGoogle Pay حسب إعدادات الحساب');add('paypal','PayPal','🅿️','دفع عالمي حسب بلد العميل');}
  if(configuredProvider('mock')) add('mock','دفع تجريبي','🧪','للتطوير فقط');
  return {country:cc,currency:cur,currency_name:CURRENCY_META[cur]?.name||cur,methods:out};
}
app.get('/api/payment-options', (req,res)=>{const country=String(req.query.country||'').toUpperCase(); const currency=String(req.query.currency||COUNTRY_CURRENCY[country]||'USD').toUpperCase(); res.json(paymentOptions(country,currency));});

async function stripeCreateCheckout(req,payment){
  if(!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY_missing');
  if(!supportedGlobalCurrency(payment.currency)) throw new Error('STRIPE_CURRENCY_NOT_SUPPORTED');
  const base=publicAppUrl(req), meta=payment.metadata||{};
  const params=new URLSearchParams();
  params.set('mode','payment');
  params.set('success_url',`${base}/checkout.html?payment=${payment.id}&stripe_session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url',`${base}/checkout.html?payment=${payment.id}&cancelled=1`);
  params.set('line_items[0][quantity]','1');
  params.set('line_items[0][price_data][currency]',String(payment.currency).toLowerCase());
  params.set('line_items[0][price_data][unit_amount]',String(paymentAmountMinor(payment.amount,payment.currency)));
  params.set('line_items[0][price_data][product_data][name]',meta.kind==='wallet_topup'?'شحن المحفظة الإعلانية — عقارتكم':'اشتراك المكتب — عقارتكم');
  params.set('client_reference_id',String(payment.id));
  params.set('metadata[payment_id]',String(payment.id));
  params.set('invoice_creation[enabled]','true');
  const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded'},body:params});
  const body=await r.json().catch(()=>({})); if(!r.ok) throw new Error(body.error?.message||`Stripe HTTP ${r.status}`);
  await pool.query(`UPDATE payments SET checkout_url=$1,provider_payment_id=$2,metadata=metadata||$3::jsonb WHERE id=$4`,[body.url,body.id,JSON.stringify({stripe_session_id:body.id}),payment.id]);
  return {payment_id:payment.id,checkout_url:body.url,mode:'stripe',session_id:body.id};
}
async function paypalAccessToken(){
  if(!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) throw new Error('PAYPAL_NOT_CONFIGURED');
  const base=String(process.env.PAYPAL_BASE_URL||'https://api-m.sandbox.paypal.com').replace(/\/$/,'');
  const r=await fetch(`${base}/v1/oauth2/token`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  const body=await r.json().catch(()=>({})); if(!r.ok) throw new Error(body.error_description||`PayPal auth HTTP ${r.status}`); return {token:body.access_token,base};
}
async function paypalCreateOrder(req,payment){
  if(!supportedGlobalCurrency(payment.currency)) throw new Error('PAYPAL_CURRENCY_NOT_SUPPORTED');
  const {token,base}=await paypalAccessToken(); const requestId=`aq-${payment.id}-${crypto.randomBytes(6).toString('hex')}`;
  const r=await fetch(`${base}/v2/checkout/orders`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','PayPal-Request-Id':requestId},body:JSON.stringify({intent:'CAPTURE',purchase_units:[{reference_id:String(payment.id),description:payment.metadata?.kind==='wallet_topup'?'شحن المحفظة الإعلانية — عقارتكم':'اشتراك المكتب — عقارتكم',amount:{currency_code:String(payment.currency).toUpperCase(),value:Number(payment.amount).toFixed(2)}}],application_context:{brand_name:'عقارتكم',user_action:'PAY_NOW',return_url:`${publicAppUrl(req)}/checkout.html?payment=${payment.id}&provider=paypal`,cancel_url:`${publicAppUrl(req)}/checkout.html?payment=${payment.id}&cancelled=1`}})});
  const body=await r.json().catch(()=>({})); if(!r.ok) throw new Error(body.message||`PayPal HTTP ${r.status}`);
  const approve=(body.links||[]).find(x=>x.rel==='approve')?.href; if(!approve) throw new Error('PAYPAL_APPROVAL_URL_MISSING');
  await pool.query(`UPDATE payments SET checkout_url=$1,provider_payment_id=$2,metadata=metadata||$3::jsonb WHERE id=$4`,[approve,body.id,JSON.stringify({paypal_order_id:body.id}),payment.id]);
  return {payment_id:payment.id,checkout_url:approve,mode:'paypal',order_id:body.id};
}
async function paypalCaptureOrder(paymentId,orderId){
  const rpay=await pool.query(`SELECT * FROM payments WHERE id=$1 AND provider='paypal'`,[paymentId]); const pay=rpay.rows[0]; if(!pay) throw new Error('payment_missing');
  if(pay.status==='paid') return {ok:true,status:'paid',already:true}; if(String(pay.provider_payment_id)!==String(orderId)) throw new Error('PAYPAL_ORDER_MISMATCH');
  const {token,base}=await paypalAccessToken();
  const r=await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','PayPal-Request-Id':`aq-cap-${paymentId}-${orderId}`},body:'{}'});
  const body=await r.json().catch(()=>({})); if(!r.ok) throw new Error(body.message||`PayPal capture HTTP ${r.status}`);
  if(body.status!=='COMPLETED') return {ok:false,status:body.status};
  const cap=body.purchase_units?.[0]?.payments?.captures?.[0];
  if(!cap || Number(cap.amount?.value)!==Number(pay.amount) || String(cap.amount?.currency_code).toUpperCase()!==String(pay.currency).toUpperCase()) throw new Error('PAYPAL_AMOUNT_OR_CURRENCY_MISMATCH');
  return finalizePaidPayment(pay.id,orderId,body);
}
async function createProviderCheckout(req,payment){
  const provider=String(payment.provider||paymentProvider()).toLowerCase(),checkout=`/checkout.html?payment=${payment.id}`;
  if(provider==='mock' && isProduction) throw new Error('payment_provider_not_configured');
  if(provider==='mock'){await pool.query(`UPDATE payments SET checkout_url=$1 WHERE id=$2`,[checkout,payment.id]);return {payment_id:payment.id,checkout_url:checkout,mode:'mock'};}
  if(provider==='moyasar'){if(!process.env.MOYASAR_PUBLISHABLE_KEY)throw new Error('MOYASAR_PUBLISHABLE_KEY_missing');await pool.query(`UPDATE payments SET checkout_url=$1 WHERE id=$2`,[checkout,payment.id]);return {payment_id:payment.id,checkout_url:checkout,mode:'moyasar'};}
  if(provider==='stripe') return stripeCreateCheckout(req,payment);
  if(provider==='paypal') return paypalCreateOrder(req,payment);
  if(provider==='syriatel_cash'){
    if(String(payment.currency).toUpperCase()!=='SYP') throw new Error('SYRIATEL_CASH_REQUIRES_SYP');
    await pool.query(`UPDATE payments SET checkout_url=$1 WHERE id=$2`,[checkout,payment.id]);
    return {payment_id:payment.id,checkout_url:checkout,mode:'syriatel_cash',recipient:process.env.SYRIATEL_CASH_ACCOUNT||'',label:process.env.SYRIATEL_CASH_RECIPIENT_LABEL||'عقارتكم',currency:'SYP'};
  }
  if(provider==='shamcash'){
    if(String(payment.currency).toUpperCase()!=='SYP') throw new Error('SHAM_CASH_REQUIRES_SYP');
    if(!shamCash.isConfigured()) throw new Error('SHAM_CASH_NOT_CONFIGURED');
    await pool.query(`UPDATE payments SET checkout_url=$1 WHERE id=$2`,[checkout,payment.id]);
    return {payment_id:payment.id,checkout_url:checkout,mode:'shamcash',recipient:process.env.SHAM_CASH_ACCOUNT_ADDRESS,label:process.env.SHAM_CASH_RECIPIENT_LABEL||'عقارتكم',currency:'SYP'};
  }
  throw new Error('payment_provider_not_configured');
}

app.post('/api/office/subscribe', requireOfficeMember, async(req,res)=>{
  try{const planId=Number(req.body.plan_id);const requestedProvider=String(req.body.provider||paymentProvider()).toLowerCase();const plan=(await pool.query(`SELECT * FROM office_plans WHERE id=$1 AND is_active=TRUE`,[planId])).rows[0];if(!plan)return res.status(404).json({error:'الباقة غير موجودة'});const payment=(await pool.query(`INSERT INTO payments(user_id,office_id,amount,currency,status,provider,payment_method,review_status,metadata) VALUES($1,$2,$3,$4,'pending',$5,$5,CASE WHEN $5 IN ('shamcash','syriatel_cash') THEN 'pending' ELSE 'not_required' END,$6) RETURNING *`,[req.user.id,req.office.id,plan.price,plan.currency,requestedProvider,JSON.stringify({kind:'subscription',plan_id:plan.id,provider:requestedProvider})])).rows[0];const result=await createProviderCheckout(req,payment);res.status(201).json({...result,message:result.mode==='mock'?'الدفع التجريبي مفعل.':'تم تجهيز الدفع الإلكتروني.'});}
  catch(e){console.error(e);res.status(500).json({error:e.message==='MOYASAR_PUBLISHABLE_KEY_missing'?'مفتاح الدفع العام غير مهيأ.':e.message==='SHAM_CASH_NOT_CONFIGURED'?'تكامل شام كاش غير مهيأ.':e.message==='SHAM_CASH_REQUIRES_SYP'?'الدفع عبر شام كاش متاح حالياً بالليرة السورية فقط.':'تعذر إنشاء عملية الدفع'});}
});

app.get('/api/checkout/:id', requireAuth, async(req,res)=>{
  try{const r=await pool.query(`SELECT p.*,o.name office_name,op.name plan_name FROM payments p LEFT JOIN offices o ON o.id=p.office_id LEFT JOIN office_subscriptions s ON s.id=p.subscription_id LEFT JOIN office_plans op ON op.id=s.plan_id WHERE p.id=$1 AND (p.user_id=$2 OR o.owner_id=$2)`,[req.params.id,req.user.id]); if(!r.rows[0])return res.status(404).json({error:'عملية الدفع غير موجودة'});res.json({data:r.rows[0]});}
  catch(e){res.status(500).json({error:'تعذر تحميل عملية الدفع'});}
});

app.get('/api/checkout/:id/config', requireAuth, async(req,res)=>{
  try{const r=await pool.query(`SELECT p.*,o.owner_id FROM payments p LEFT JOIN offices o ON o.id=p.office_id WHERE p.id=$1 AND (p.user_id=$2 OR o.owner_id=$2)`,[req.params.id,req.user.id]);const p=r.rows[0];if(!p)return res.status(404).json({error:'عملية الدفع غير موجودة'});
    if(String(p.provider)==='moyasar')return res.json({provider:'moyasar',publishable_api_key:process.env.MOYASAR_PUBLISHABLE_KEY,amount_minor:paymentAmountMinor(p.amount,p.currency),currency:p.currency,description:`عقارتكم - ${p.metadata?.kind==='wallet_topup'?'شحن المحفظة الإعلانية':'اشتراك المكتب'}`,callback_url:`${publicAppUrl(req)}/checkout.html?payment=${p.id}`});
    if(String(p.provider)==='stripe')return res.json({provider:'stripe',amount:p.amount,currency:p.currency,checkout_url:p.checkout_url,session_id:p.provider_payment_id});
    if(String(p.provider)==='paypal')return res.json({provider:'paypal',amount:p.amount,currency:p.currency,checkout_url:p.checkout_url,order_id:p.provider_payment_id});
    if(String(p.provider)==='syriatel_cash')return res.json({provider:'syriatel_cash',amount:p.amount,currency:p.currency,recipient:process.env.SYRIATEL_CASH_ACCOUNT||'',label:process.env.SYRIATEL_CASH_RECIPIENT_LABEL||'عقارتكم',instructions:'حوّل المبلغ إلى حساب عقارتكم في سيرياتيل كاش، ثم أدخل رقم العملية لإرسالها للمراجعة.'});
    if(String(p.provider)==='shamcash' && !shamCash.isConfigured())return res.status(503).json({error:'الدفع عبر شام كاش غير مفعّل حالياً. لا تحوّل أي مبلغ.'});
    if(String(p.provider)==='shamcash')return res.json({provider:'shamcash',amount:p.amount,currency:p.currency,recipient:process.env.SHAM_CASH_ACCOUNT_ADDRESS,label:process.env.SHAM_CASH_RECIPIENT_LABEL||'عقارتكم',instructions:'حوّل المبلغ إلى حساب عقارتكم في شام كاش، ثم أدخل رقم العملية الظاهر في تطبيق شام كاش للتحقق التلقائي.'});
    res.json({provider:'mock',amount:p.amount,currency:p.currency});
  }catch(e){res.status(500).json({error:'تعذر تحميل إعدادات الدفع'});}
});
app.post('/api/checkout/:id/attach-provider', requireAuth, async(req,res)=>{try{const providerId=String(req.body.provider_payment_id||'');if(!providerId)return res.status(400).json({error:'معرف الدفع غير موجود'});const r=await pool.query(`UPDATE payments p SET provider_payment_id=$3 WHERE p.id=$1 AND p.provider='moyasar' AND p.status='pending' AND (p.user_id=$2 OR p.office_id IN (SELECT office_id FROM users WHERE id=$2)) RETURNING id`,[req.params.id,req.user.id,providerId]);if(!r.rows[0])return res.status(404).json({error:'عملية الدفع غير موجودة'});res.json({ok:true});}catch(e){console.error(e);res.status(500).json({error:'تعذر حفظ معرف الدفع'});}});
app.post('/api/checkout/:id/syriatel/submit', requireAuth, async(req,res)=>{
  try{
    const r=await pool.query(`SELECT p.* FROM payments p WHERE p.id=$1 AND p.user_id=$2`,[req.params.id,req.user.id]); const p=r.rows[0];
    if(!p)return res.status(404).json({error:'عملية الدفع غير موجودة'});
    if(p.provider!=='syriatel_cash')return res.status(400).json({error:'عملية الدفع ليست عبر سيرياتيل كاش'});
    const tx=String(req.body.transaction_id||'').trim(); if(tx.length<3||tx.length>80)return res.status(400).json({error:'رقم العملية غير صحيح'});
    await pool.query(`UPDATE payments SET transaction_reference=$2,review_status='pending',payment_method='syriatel_cash',metadata=metadata||$3::jsonb WHERE id=$1 AND status='pending'`,[p.id,tx,JSON.stringify({submitted_for_review:true})]);
    res.json({ok:true,status:'pending',message:'تم إرسال العملية للمراجعة. سيتم إضافة الرصيد بعد اعتماد الإدارة.'});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر إرسال العملية للمراجعة'});}
});
shamCash.register(app, {pool, requireAuth, finalizePaidPayment});
async function stripeRetrieveSession(sessionId){
  if(!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY_missing');
  const r=await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,{headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`}});
  const body=await r.json().catch(()=>({})); if(!r.ok) throw new Error(body.error?.message||`Stripe HTTP ${r.status}`); return body;
}
app.post('/api/checkout/:id/stripe/verify', requireAuth, async(req,res)=>{try{const r=await pool.query(`SELECT p.* FROM payments p WHERE p.id=$1 AND (p.user_id=$2 OR p.office_id IN (SELECT office_id FROM users WHERE id=$2))`,[req.params.id,req.user.id]);const p=r.rows[0];if(!p)return res.status(404).json({error:'عملية الدفع غير موجودة'});if(p.provider!=='stripe')return res.status(400).json({error:'عملية الدفع ليست عبر Stripe'});const sid=String(req.body.session_id||p.provider_payment_id||'');if(!sid)return res.status(400).json({error:'معرف جلسة Stripe غير موجود'});const remote=await stripeRetrieveSession(sid);if(remote.payment_status==='paid'){if(Number(remote.amount_total)!==paymentAmountMinor(p.amount,p.currency)||String(remote.currency).toUpperCase()!==String(p.currency).toUpperCase())return res.status(400).json({error:'فشل التحقق من مبلغ أو عملة الدفع'});return res.json(await finalizePaidPayment(p.id,remote.payment_intent||sid,remote));}return res.json({ok:false,status:remote.payment_status||remote.status});}catch(e){console.error(e);res.status(500).json({error:e.message==='STRIPE_SECRET_KEY_missing'?'Stripe غير مهيأ على الخادم.':'تعذر التحقق من دفع Stripe'});}});
app.post('/api/checkout/:id/paypal/capture', requireAuth, async(req,res)=>{try{const r=await pool.query(`SELECT p.* FROM payments p WHERE p.id=$1 AND (p.user_id=$2 OR p.office_id IN (SELECT office_id FROM users WHERE id=$2))`,[req.params.id,req.user.id]);const p=r.rows[0];if(!p)return res.status(404).json({error:'عملية الدفع غير موجودة'});if(p.provider!=='paypal')return res.status(400).json({error:'عملية الدفع ليست عبر PayPal'});const orderId=String(req.body.order_id||p.provider_payment_id||'');if(!orderId)return res.status(400).json({error:'رقم طلب PayPal غير موجود'});res.json(await paypalCaptureOrder(p.id,orderId));}catch(e){console.error(e);res.status(500).json({error:e.message==='PAYPAL_NOT_CONFIGURED'?'PayPal غير مهيأ على الخادم.':e.message==='PAYPAL_CURRENCY_NOT_SUPPORTED'?'عملة PayPal غير مدعومة لهذه العملية.':'تعذر إتمام دفع PayPal'});}});
app.get('/api/checkout/:id/verify', requireAuth, async(req,res)=>{
  try{const r=await pool.query(`SELECT p.*,o.owner_id FROM payments p LEFT JOIN offices o ON o.id=p.office_id WHERE p.id=$1 AND (p.user_id=$2 OR o.owner_id=$2)`,[req.params.id,req.user.id]);const local=r.rows[0];if(!local)return res.status(404).json({error:'عملية الدفع غير موجودة'});if(local.status==='paid')return res.json({ok:true,status:'paid'});if(local.provider!=='moyasar')return res.json({ok:true,status:local.status});const providerId=String(req.query.provider_id||'');if(!providerId)return res.status(400).json({error:'معرف الدفع غير موجود'});const remote=await moyasarFetchPayment(providerId);if(remote.status==='paid'||remote.status==='captured'){if(Number(remote.amount)!==paymentAmountMinor(local.amount,local.currency)||String(remote.currency).toUpperCase()!==String(local.currency).toUpperCase())return res.status(400).json({error:'فشل التحقق من مبلغ أو عملة الدفع'});return res.json(await finalizePaidPayment(local.id,providerId,remote));}if(remote.status==='failed'){await pool.query(`UPDATE payments SET status='failed',provider_payment_id=$2 WHERE id=$1 AND status='pending'`,[local.id,providerId]);return res.json({ok:false,status:'failed'});}res.json({ok:false,status:remote.status});}
  catch(e){console.error(e);res.status(500).json({error:'تعذر التحقق من عملية الدفع'});}
});
app.post('/api/checkout/:id/pay', requireAuth, async(req,res)=>{try{const r=await pool.query(`SELECT p.*,o.owner_id FROM payments p LEFT JOIN offices o ON o.id=p.office_id WHERE p.id=$1 AND (p.user_id=$2 OR o.owner_id=$2)`,[req.params.id,req.user.id]);const pay=r.rows[0];if(!pay)return res.status(404).json({error:'عملية الدفع غير موجودة'});if(isProduction||pay.provider!=='mock'||paymentProvider()!=='mock')return res.status(400).json({error:'هذه العملية تستخدم بوابة دفع حقيقية'});if(pay.status==='paid')return res.json({ok:true,status:'paid'});res.json(await finalizePaidPayment(pay.id,`local-${pay.id}`,null));}catch(e){console.error(e);res.status(500).json({error:'تعذر إتمام الدفع'});}});
app.post('/api/payments/moyasar/webhook', async(req,res)=>{try{if(!process.env.MOYASAR_WEBHOOK_SECRET||req.body?.secret_token!==process.env.MOYASAR_WEBHOOK_SECRET)return res.status(401).json({error:'unauthorized'});const event=req.body||{},remote=event.data||{},providerId=remote.id;if(!providerId)return res.json({ok:true});const pay=(await pool.query(`SELECT * FROM payments WHERE provider='moyasar' AND provider_payment_id=$1 LIMIT 1`,[providerId])).rows[0];if(!pay)return res.json({ok:true});if(event.type==='payment_paid'||remote.status==='paid'||remote.status==='captured'){if(Number(remote.amount)!==paymentAmountMinor(pay.amount,pay.currency)||String(remote.currency).toUpperCase()!==String(pay.currency).toUpperCase())return res.status(400).json({error:'amount_or_currency_mismatch'});await finalizePaidPayment(pay.id,providerId,remote);}else if(event.type==='payment_failed')await pool.query(`UPDATE payments SET status='failed' WHERE id=$1 AND status='pending'`,[pay.id]);else if(event.type==='payment_refunded')await pool.query(`UPDATE payments SET status='refunded' WHERE id=$1`,[pay.id]);res.json({ok:true});}catch(e){console.error(e);res.status(500).json({error:'webhook_error'});}});

async function ensureWallet(officeId, client=pool){
  await client.query(`INSERT INTO office_wallets(office_id) VALUES($1) ON CONFLICT (office_id) DO NOTHING`,[officeId]);
  return (await client.query(`SELECT * FROM office_wallets WHERE office_id=$1`,[officeId])).rows[0];
}
app.get('/api/office/wallet', requireOfficeMember, async(req,res)=>{
  try{
    await ensureWallet(req.office.id);
    const [w,tx,inv]=await Promise.all([
      pool.query(`SELECT * FROM office_wallets WHERE office_id=$1`,[req.office.id]),
      pool.query(`SELECT * FROM wallet_transactions WHERE office_id=$1 ORDER BY created_at DESC LIMIT 100`,[req.office.id]),
      pool.query(`SELECT i.*,a.title campaign_title,p.title property_title FROM ad_invoices i LEFT JOIN office_ads a ON a.id=i.ad_id LEFT JOIN properties p ON p.id=a.property_id WHERE i.office_id=$1 ORDER BY i.created_at DESC LIMIT 100`,[req.office.id])
    ]);
    res.json({wallet:w.rows[0],transactions:tx.rows,invoices:inv.rows});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل المحفظة'});}
});
app.post('/api/office/wallet/topup', requireOfficeMember, async(req,res)=>{try{const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<10||amount>100000)return res.status(400).json({error:'قيمة الشحن يجب أن تكون بين 10 و100000'});const provider=String(req.body.provider||paymentProvider()).toLowerCase();const country=String(req.body.country||'').toUpperCase();let currency=String(req.body.currency||COUNTRY_CURRENCY[country]||process.env.PAYMENT_CURRENCY||'USD').toUpperCase();const opts=paymentOptions(country,currency);if(!opts.methods.some(m=>m.id===provider))return res.status(400).json({error:'طريقة الدفع غير متاحة لهذه الدولة أو العملة'});await ensureWallet(req.office.id);let wallet=(await pool.query(`SELECT * FROM office_wallets WHERE office_id=$1`,[req.office.id])).rows[0];if(provider==='shamcash'||provider==='syriatel_cash')currency='SYP';if(Number(wallet.balance)!==0 && String(wallet.currency||'').toUpperCase()!==currency)return res.status(400).json({error:`محفظتك الحالية بعملة ${wallet.currency}. لا يمكن تغيير العملة مع وجود رصيد.`});if(Number(wallet.balance)===0 && String(wallet.currency||'').toUpperCase()!==currency){await pool.query(`UPDATE office_wallets SET currency=$1,updated_at=NOW() WHERE office_id=$2`,[currency,req.office.id]);}const payment=(await pool.query(`INSERT INTO payments(user_id,office_id,amount,currency,status,provider,payment_method,review_status,metadata) VALUES($1,$2,$3,$4,'pending',$5,$5,CASE WHEN $5 IN ('shamcash','syriatel_cash') THEN 'pending' ELSE 'not_required' END,$6) RETURNING *`,[req.user.id,req.office.id,amount,currency,provider,JSON.stringify({kind:'wallet_topup',amount,provider,country,currency})])).rows[0];const result=await createProviderCheckout(req,payment);res.status(201).json({...result,amount,currency});}catch(e){console.error(e);res.status(500).json({error:e.message==='MOYASAR_PUBLISHABLE_KEY_missing'?'مفتاح الدفع العام غير مهيأ.':e.message==='SHAM_CASH_NOT_CONFIGURED'?'تكامل شام كاش غير مهيأ.':e.message==='SHAM_CASH_REQUIRES_SYP'?'الدفع عبر شام كاش متاح حالياً بالليرة السورية فقط.':'تعذر إنشاء عملية شحن المحفظة'});}});
app.get('/api/office/invoices/:id', requireOfficeMember, async(req,res)=>{try{const r=await pool.query(`SELECT i.*,a.title campaign_title,p.title property_title,o.name office_name FROM ad_invoices i LEFT JOIN office_ads a ON a.id=i.ad_id LEFT JOIN properties p ON p.id=a.property_id JOIN offices o ON o.id=i.office_id WHERE i.id=$1 AND i.office_id=$2`,[req.params.id,req.office.id]);if(!r.rows[0])return res.status(404).json({error:'الفاتورة غير موجودة'});res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر تحميل الفاتورة'});}});

app.get('/api/office/ads', requireOfficeMember, async(req,res)=>{
  try{const r=await pool.query(`SELECT a.*,p.title property_title FROM office_ads a LEFT JOIN properties p ON p.id=a.property_id WHERE a.office_id=$1 ORDER BY a.created_at DESC`,[req.office.id]);res.json({data:r.rows});}
  catch(e){res.status(500).json({error:'تعذر تحميل الإعلانات'});}
});
app.post('/api/office/ads', requireOfficeMember, async(req,res)=>{
  try{
    const b=req.body; if(!b.property_id)return res.status(400).json({error:'اختر العقار'});
    const sub=await officeSubscription(req.office.id); if(!sub)return res.status(403).json({error:'فعّل باقة أولاً'});
    const activeAds=(await pool.query(`SELECT COUNT(*)::int count FROM office_ads WHERE office_id=$1 AND status IN ('pending','active')`,[req.office.id])).rows[0].count;
    if(sub.max_ads>=0 && activeAds>=sub.max_ads)return res.status(403).json({error:`الباقة تسمح بـ ${sub.max_ads} حملات إعلانية فقط`});
    const prop=(await pool.query(`SELECT id FROM properties WHERE id=$1 AND office_id=$2`,[b.property_id,req.office.id])).rows[0]; if(!prop)return res.status(404).json({error:'العقار غير موجود في مكتبك'});
    const targetLat=b.target_lat!==''&&b.target_lat!=null?Number(b.target_lat):null;
    const targetLng=b.target_lng!==''&&b.target_lng!=null?Number(b.target_lng):null;
    const targetRadius=b.target_radius_km!==''&&b.target_radius_km!=null?Math.min(200,Math.max(0.5,Number(b.target_radius_km))):null;
    if((targetLat==null)!=(targetLng==null)) return res.status(400).json({error:'حدد خط العرض وخط الطول معاً'});
    if(targetLat!=null && (!Number.isFinite(targetLat)||!Number.isFinite(targetLng)||!Number.isFinite(targetRadius))) return res.status(400).json({error:'بيانات الاستهداف الجغرافي غير صحيحة'});
    const r=await pool.query(`INSERT INTO office_ads(office_id,property_id,title,placement,status,starts_at,ends_at,budget,priority,daily_budget,billing_model,bid,target_lat,target_lng,target_radius_km,target_label) VALUES($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[req.office.id,b.property_id,b.title||null,b.placement||'featured',b.starts_at||null,b.ends_at||null,Number(b.budget)||0,Math.min(1000,Math.max(1,Number(b.priority)||100)),Number(b.daily_budget)||0,['cpc','cpm'].includes(b.billing_model)?b.billing_model:'cpc',Math.max(0,Number(b.bid)||0),targetLat,targetLng,targetRadius,b.target_label||null]);res.status(201).json({data:r.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر إنشاء الإعلان'});}
});
app.patch('/api/office/ads/:id', requireOfficeMember, async(req,res)=>{try{const r=await pool.query(`UPDATE office_ads SET status=COALESCE($1,status),starts_at=COALESCE($2,starts_at),ends_at=COALESCE($3,ends_at) WHERE id=$4 AND office_id=$5 RETURNING *`,[req.body.status||null,req.body.starts_at||null,req.body.ends_at||null,req.params.id,req.office.id]);if(!r.rows[0])return res.status(404).json({error:'الإعلان غير موجود'});res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر تحديث الإعلان'});}});

const docUpload=multer({storage,limits:{fileSize:10*1024*1024},fileFilter:(_req,file,cb)=>cb(null,/^(application\/pdf|image\/jpeg|image\/png|image\/webp)$/.test(file.mimetype))});
app.get('/api/office/verification', requireOfficeMember, async(req,res)=>{try{const r=await pool.query(`SELECT * FROM office_verifications WHERE office_id=$1 ORDER BY created_at DESC LIMIT 10`,[req.office.id]);res.json({data:r.rows,verified:req.office.verified});}catch(e){res.status(500).json({error:'تعذر تحميل حالة التوثيق'});}});
app.post('/api/office/verification', requireOfficeMember, docUpload.single('document'), async(req,res)=>{try{if(!req.file)return res.status(400).json({error:'أرفق مستند التوثيق'});const url='/uploads/'+req.file.filename;const r=await pool.query(`INSERT INTO office_verifications(office_id,status,document_url,document_type,notes) VALUES($1,'pending',$2,$3,$4) RETURNING *`,[req.office.id,url,req.body.document_type||req.file.mimetype,req.body.notes||null]);res.status(201).json({data:r.rows[0],message:'تم إرسال طلب التوثيق للمراجعة'});}catch(e){console.error(e);res.status(500).json({error:'تعذر إرسال طلب التوثيق'});}});

app.get('/api/public/offices/:slug', async(req,res)=>{try{
  const office=(await pool.query(`SELECT o.id,o.name,o.slug,o.phone,o.whatsapp,o.city,o.district,o.address,o.description,o.logo_url,o.verified,o.created_at,(SELECT COUNT(*) FROM properties p WHERE p.office_id=o.id AND p.status='active')::int properties_count,(SELECT COUNT(*) FROM users u WHERE u.office_id=o.id AND u.is_active=TRUE)::int staff_count FROM offices o WHERE o.slug=$1`,[req.params.slug])).rows[0];
  if(!office)return res.status(404).json({error:'المكتب غير موجود'});
  const [props,staff]=await Promise.all([pool.query(`SELECT id,title,type,mode,city,district,price,currency,area,rooms,baths,image_url,featured,views_count FROM properties WHERE office_id=$1 AND status='active' ORDER BY featured DESC,created_at DESC LIMIT 60`,[office.id]),pool.query(`SELECT id,name,phone,office_title FROM users WHERE office_id=$1 AND is_active=TRUE ORDER BY office_title,name`,[office.id])]);
  res.json({office,properties:props.rows,staff:staff.rows});
}catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل صفحة المكتب'});}});

// Admin controls for verification and monetization
app.get('/api/admin/office-verifications', requireAdmin, async(_req,res)=>{try{const r=await pool.query(`SELECT v.*,o.name office_name,o.slug,u.name owner_name FROM office_verifications v JOIN offices o ON o.id=v.office_id JOIN users u ON u.id=o.owner_id ORDER BY v.created_at DESC`);res.json({data:r.rows});}catch(e){res.status(500).json({error:'تعذر تحميل طلبات التوثيق'});}});
app.patch('/api/admin/office-verifications/:id', requireAdmin, async(req,res)=>{try{const status=req.body.status;if(!['approved','rejected','pending'].includes(status))return res.status(400).json({error:'حالة غير صحيحة'});const r=await pool.query(`UPDATE office_verifications SET status=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3 RETURNING *`,[status,req.user.id,req.params.id]);if(!r.rows[0])return res.status(404).json({error:'الطلب غير موجود'});if(status==='approved')await pool.query(`UPDATE offices SET verified=TRUE,updated_at=NOW() WHERE id=$1`,[r.rows[0].office_id]);if(status==='rejected')await pool.query(`UPDATE offices SET verified=FALSE,updated_at=NOW() WHERE id=$1`,[r.rows[0].office_id]);res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر تحديث التوثيق'});}});
app.get('/api/admin/office-ads', requireAdmin, async(_req,res)=>{try{const r=await pool.query(`SELECT a.*,o.name office_name,p.title property_title FROM office_ads a JOIN offices o ON o.id=a.office_id LEFT JOIN properties p ON p.id=a.property_id ORDER BY a.created_at DESC`);res.json({data:r.rows});}catch(e){res.status(500).json({error:'تعذر تحميل الإعلانات'});}});
app.patch('/api/admin/office-ads/:id', requireAdmin, async(req,res)=>{try{const status=req.body.status;if(!['pending','active','paused','expired','rejected'].includes(status))return res.status(400).json({error:'حالة غير صحيحة'});const r=await pool.query(`UPDATE office_ads SET status=$1 WHERE id=$2 RETURNING *`,[status,req.params.id]);if(!r.rows[0])return res.status(404).json({error:'الإعلان غير موجود'});res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر تحديث الإعلان'});}});

app.get('/api/health', async (_req, res) => {
  try { const result = await pool.query('SELECT NOW() AS now'); res.json({ ok: true, database: 'connected', time: result.rows[0].now }); }
  catch (error) { res.status(503).json({ ok: false, database: 'disconnected', error: error.message }); }
});

// ---------------- Authentication ----------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const phone = String(req.body.phone || '').trim() || null;
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'الاسم يجب أن يكون بين حرفين و120 حرفاً' });
    if (!validEmail(email)) return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
    if (password.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
    const exists = await pool.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    if (exists.rows[0]) return res.status(409).json({ error: 'البريد الإلكتروني مستخدم مسبقاً' });
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(`INSERT INTO users (name,email,phone,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,name,email,phone,role,created_at`, [name,email,phone,passwordHash]);
    await createSession(result.rows[0].id, res);
    res.status(201).json({ user: result.rows[0] });
  } catch (error) { console.error(error); res.status(500).json({ error: 'تعذر إنشاء الحساب' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const result = await pool.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1', [email]);
    const user = result.rows[0];
    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    await createSession(user.id, res);
    res.json({ user: { id:user.id,name:user.name,email:user.email,phone:user.phone,role:user.role,created_at:user.created_at } });
  } catch (error) { console.error(error); res.status(500).json({ error: 'تعذر تسجيل الدخول' }); }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) { clearSessionCookie(res); res.json({ ok: true }); }
});

app.get('/api/auth/me', async (req, res) => {
  try { const user = await getCurrentUser(req); res.json({ user }); }
  catch (error) { res.status(500).json({ error: 'تعذر تحميل الحساب' }); }
});

app.get('/api/me/dashboard', requireAuth, async (req,res)=>{
  try {
    const [props, stats, inquiries] = await Promise.all([
      pool.query(`SELECT p.*, COALESCE((SELECT json_agg(json_build_object('id',pi.id,'url',pi.url,'sort_order',pi.sort_order) ORDER BY pi.sort_order,pi.id) FROM property_images pi WHERE pi.property_id=p.id),'[]') AS images, COALESCE((SELECT json_agg(json_build_object('id',pv.id,'url',pv.url,'poster_url',pv.poster_url,'title',pv.title,'source_type',pv.source_type,'is_primary',pv.is_primary) ORDER BY pv.created_at DESC) FROM property_videos pv WHERE pv.property_id=p.id),'[]') AS videos, (SELECT COUNT(*) FROM inquiries i WHERE i.property_id=p.id AND i.status='new') AS new_inquiries FROM properties p WHERE p.owner_id=$1 ORDER BY p.created_at DESC`,[req.user.id]),
      pool.query(`SELECT COUNT(*) AS properties, COALESCE(SUM(p.views_count),0) AS views, (SELECT COUNT(*) FROM inquiries i JOIN properties pp ON pp.id=i.property_id WHERE pp.owner_id=$1) AS inquiries FROM properties p WHERE p.owner_id=$1`,[req.user.id]),
      pool.query(`SELECT i.*, p.title FROM inquiries i JOIN properties p ON p.id=i.property_id WHERE p.owner_id=$1 ORDER BY i.created_at DESC LIMIT 50`,[req.user.id])
    ]);
    res.json({user:req.user, stats:stats.rows[0], properties:props.rows, inquiries:inquiries.rows});
  } catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل لوحة التحكم'});}
});

app.get('/api/me/properties', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT * FROM properties WHERE owner_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ data: result.rows });
});

app.put('/api/me/properties/:id', requireAuth, async (req,res)=>{
  try {
    const id=Number(req.params.id);
    const {title,type,mode,city,district='',price,currency='USD',area=null,rooms=null,baths=null,description='',latitude=null,longitude=null}=req.body;
    if(!Number.isInteger(id)||!title||!type||!city||price===''||price===undefined) return res.status(400).json({error:'بيانات العقار غير مكتملة'});
    if(!['بيع','إيجار'].includes(mode))return res.status(400).json({error:'نوع العملية غير صحيح'});
    if([area,rooms,baths].some(v=>v!==null&&v!==''&&(!Number.isFinite(Number(v))||Number(v)<0)))return res.status(400).json({error:'المساحة وعدد الغرف والحمامات يجب أن تكون أرقامًا صالحة'});
    const propertyCurrency=String(currency||'USD').toUpperCase();
    if(!FX_SUPPORTED.includes(propertyCurrency)) return res.status(400).json({error:'عملة العقار غير مدعومة'});
    const hasLat=latitude!==null&&latitude!=='',hasLng=longitude!==null&&longitude!=='';
    if(hasLat!==hasLng||(hasLat&&(!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude))||Math.abs(Number(latitude))>90||Math.abs(Number(longitude))>180)))return res.status(400).json({error:'أدخل إحداثيين صالحين للموقع أو اتركهما فارغين'});
    if(!Number.isFinite(Number(price))||Number(price)<0)return res.status(400).json({error:'السعر غير صالح'});
    const r=await pool.query(`UPDATE properties SET title=$1,type=$2,mode=$3,city=$4,district=$5,price=$6,currency=$7,area=$8,rooms=$9,baths=$10,description=$11,latitude=$12,longitude=$13,updated_at=NOW() WHERE id=$14 AND owner_id=$15 RETURNING *`,[title,type,mode,city,district,Number(price),propertyCurrency,area?Number(area):null,rooms?Number(rooms):null,baths?Number(baths):null,description,latitude!==null&&latitude!==''?Number(latitude):null,longitude!==null&&longitude!==''?Number(longitude):null,id,req.user.id]);
    if(!r.rows[0]) return res.status(404).json({error:'العقار غير موجود أو لا تملك صلاحية تعديله'});
    res.json({data:r.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تعديل العقار'});}
});

app.delete('/api/me/properties/:id', requireAuth, async (req,res)=>{
  try { const id=Number(req.params.id); const r=await pool.query('DELETE FROM properties WHERE id=$1 AND owner_id=$2 RETURNING id',[id,req.user.id]); if(!r.rows[0]) return res.status(404).json({error:'العقار غير موجود أو لا تملك صلاحية حذفه'}); res.json({ok:true}); } catch(e){res.status(500).json({error:'تعذر حذف العقار'});} 
});

app.post('/api/me/properties/:id/images', requireAuth, receiveImages, async (req,res)=>{
  try { const id=Number(req.params.id); const own=await pool.query('SELECT id FROM properties WHERE id=$1 AND owner_id=$2',[id,req.user.id]); if(!own.rows[0]) return res.status(404).json({error:'العقار غير موجود أو لا تملك صلاحية تعديله'}); const count=await pool.query('SELECT COALESCE(MAX(sort_order),-1) AS max FROM property_images WHERE property_id=$1',[id]); let order=Number(count.rows[0].max)+1; const rows=[]; for(const f of req.files||[]){const url=`/uploads/${f.filename}`; const r=await pool.query('INSERT INTO property_images(property_id,url,sort_order) VALUES($1,$2,$3) RETURNING *',[id,url,order++]); rows.push(r.rows[0]);} res.status(201).json({data:rows}); } catch(e){console.error(e);res.status(500).json({error:'تعذر رفع الصور'});} 
});

app.post('/api/me/properties/:id/videos', requireAuth, receiveVideos, async (req,res)=>{
  try {
    const id=Number(req.params.id);
    const own=await pool.query('SELECT id FROM properties WHERE id=$1 AND owner_id=$2',[id,req.user.id]);
    if(!own.rows[0]) return res.status(404).json({error:'العقار غير موجود أو لا تملك صلاحية تعديله'});
    const rows=[];
    for(const f of req.files||[]){
      const url=`/uploads/${f.filename}`;
      const posterUrl=await createVideoPoster(f.path);
      const count=await pool.query('SELECT COUNT(*)::int AS n FROM property_videos WHERE property_id=$1',[id]); const isPrimary=count.rows[0].n===0; const r=await pool.query('INSERT INTO property_videos(property_id,url,poster_url,title,is_primary) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,url,posterUrl,f.originalname||'فيديو العقار',isPrimary]);
      rows.push(r.rows[0]);
    }
    res.status(201).json({data:rows});
  } catch(e){console.error(e);res.status(500).json({error:'تعذر رفع الفيديو'});}
});

app.post('/api/me/properties/:id/external-videos', requireAuth, async (req,res)=>{
  try {
    const id=Number(req.params.id);
    const {url,title,source_type}=req.body||{};
    if(!url || typeof url!=='string') return res.status(400).json({error:'رابط الفيديو مطلوب'});
    const parsed=new URL(url.trim());
    if(!['http:','https:'].includes(parsed.protocol)) return res.status(400).json({error:'رابط الفيديو غير صالح'});
    const host=parsed.hostname.toLowerCase().replace(/^www\./,'');
    let type='external';
    if(['youtube.com','youtu.be','youtube-nocookie.com'].includes(host) || host.endsWith('.youtube.com')) type='youtube';
    else if(['vimeo.com','player.vimeo.com'].includes(host) || host.endsWith('.vimeo.com')) type='external';
    const own=await pool.query('SELECT id FROM properties WHERE id=$1 AND owner_id=$2',[id,req.user.id]);
    if(!own.rows[0]) return res.status(404).json({error:'العقار غير موجود'});
    const count=await pool.query('SELECT COUNT(*)::int AS n FROM property_videos WHERE property_id=$1',[id]);
    if(count.rows[0].n>=10) return res.status(400).json({error:'الحد الأقصى 10 فيديوهات للعقار'});
    const r=await pool.query('INSERT INTO property_videos(property_id,url,title,source_type,is_primary) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,url.trim(),(title||'فيديو العقار').slice(0,200),source_type==='youtube'?'youtube':type,count.rows[0].n===0]);
    res.status(201).json({data:r.rows[0]});
  } catch(e){ res.status(400).json({error:'تعذر إضافة رابط الفيديو'}); }
});

app.patch('/api/me/properties/:id/videos/:videoId/primary', requireAuth, async (req,res)=>{
  try {
    const own=await pool.query('SELECT p.id FROM properties p WHERE p.id=$1 AND p.owner_id=$2',[req.params.id,req.user.id]);
    if(!own.rows[0]) return res.status(404).json({error:'العقار غير موجود'});
    const v=await pool.query('SELECT id FROM property_videos WHERE id=$1 AND property_id=$2',[req.params.videoId,req.params.id]);
    if(!v.rows[0]) return res.status(404).json({error:'الفيديو غير موجود'});
    await pool.query('UPDATE property_videos SET is_primary=FALSE WHERE property_id=$1',[req.params.id]);
    const r=await pool.query('UPDATE property_videos SET is_primary=TRUE WHERE id=$1 RETURNING *',[req.params.videoId]);
    res.json({data:r.rows[0]});
  } catch(error){ console.error(error); res.status(500).json({error:'تعذر تعيين الفيديو الرئيسي'}); }
});

app.delete('/api/me/properties/:id/videos/:videoId', requireAuth, async (req,res)=>{
  try {
    const r=await pool.query(`SELECT pv.* FROM property_videos pv JOIN properties p ON p.id=pv.property_id WHERE pv.id=$1 AND pv.property_id=$2 AND p.owner_id=$3`,[req.params.videoId,req.params.id,req.user.id]);
    if(!r.rows[0]) return res.status(404).json({error:'الفيديو غير موجود'});
    const file=path.join(uploadDir,path.basename(r.rows[0].url));
    await pool.query('DELETE FROM property_videos WHERE id=$1',[req.params.videoId]);
    try{fs.unlinkSync(file)}catch{}
    res.json({ok:true});
  }catch(e){res.status(500).json({error:'تعذر حذف الفيديو'});}
});

app.delete('/api/me/properties/:id/images/:imageId', requireAuth, async (req,res)=>{
  try { const r=await pool.query(`SELECT pi.* FROM property_images pi JOIN properties p ON p.id=pi.property_id WHERE pi.id=$1 AND pi.property_id=$2 AND p.owner_id=$3`,[req.params.imageId,req.params.id,req.user.id]); if(!r.rows[0]) return res.status(404).json({error:'الصورة غير موجودة'}); const file=path.join(uploadDir,path.basename(r.rows[0].url)); await pool.query('DELETE FROM property_images WHERE id=$1',[req.params.imageId]); try{fs.unlinkSync(file)}catch{} res.json({ok:true}); }catch(e){res.status(500).json({error:'تعذر حذف الصورة'});} 
});

app.get('/api/me/inquiries', requireAuth, async (req,res)=>{ const r=await pool.query(`SELECT i.*,p.title FROM inquiries i JOIN properties p ON p.id=i.property_id WHERE p.owner_id=$1 ORDER BY i.created_at DESC`,[req.user.id]); res.json({data:r.rows}); });
app.patch('/api/me/inquiries/:id', requireAuth, async (req,res)=>{ const status=String(req.body.status||''); if(!['new','read','replied','closed'].includes(status)) return res.status(400).json({error:'حالة غير صحيحة'}); const r=await pool.query(`UPDATE inquiries i SET status=$1 FROM properties p WHERE i.id=$2 AND i.property_id=p.id AND p.owner_id=$3 RETURNING i.*`,[status,req.params.id,req.user.id]); if(!r.rows[0]) return res.status(404).json({error:'الاستفسار غير موجود'}); res.json({data:r.rows[0]}); });

app.get('/api/me/favorites', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT property_id FROM favorites WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ data: result.rows.map(r => Number(r.property_id)) });
});

app.post('/api/me/favorites/:propertyId', requireAuth, async (req, res) => {
  const id = Number(req.params.propertyId);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'معرف العقار غير صحيح' });
  const exists = await pool.query('SELECT id FROM properties WHERE id=$1', [id]);
  if (!exists.rows[0]) return res.status(404).json({ error: 'العقار غير موجود' });
  await pool.query('INSERT INTO favorites (user_id,property_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id,id]); await recordPropertyEvent(req.user.id,id,'favorite').catch(()=>{});
  res.json({ ok: true, favorite: true });
});

app.delete('/api/me/favorites/:propertyId', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM favorites WHERE user_id=$1 AND property_id=$2', [req.user.id, Number(req.params.propertyId)]);
  res.json({ ok: true, favorite: false });
});

// ---------------- Properties ----------------
app.get('/api/properties', async (req, res) => {
  try {
    const { city, district, type, mode, minPrice, maxPrice, rooms, featured, placement='search', q, limit = 50, lat, lng, radiusKm, currency='USD' } = req.query;
    const requestedCurrency = String(currency || 'USD').toUpperCase();
    const searchCurrency = FX_SUPPORTED.includes(requestedCurrency) ? requestedCurrency : 'USD';
    await ensureFxRates();
    const values = []; const where = []; let geoLatParam=null, geoLngParam=null;
    const hasGeo = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number.isFinite(Number(radiusKm)) && Number(radiusKm) > 0;
    const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
    where.push("p.status='active'", "p.is_demo=FALSE");
    if(req.query.office||req.query.availability==='sold')where.push('FALSE');
    if (city) add('p.city = ?', city);
    if (district) add('p.district ILIKE ?', '%'+String(district).trim()+'%');
    if (type) add('p.type = ?', type);
    if (mode) add('p.mode = ?', mode);
    // Price filters are interpreted in the customer's selected display currency.
    const minPriceExpr = `(p.price * COALESCE(rt.rate,1) / NULLIF(COALESCE(rf.rate,1),0))`;
    if (minPrice) add(`${minPriceExpr} >= ?`, Number(minPrice));
    if (maxPrice) add(`${minPriceExpr} <= ?`, Number(maxPrice));
    if (rooms && rooms !== '5+') add('p.rooms = ?', Number(rooms));
    if (rooms === '5+') where.push('p.rooms >= 5');
    if (featured === 'true') where.push('p.featured = TRUE');
    if (q) { values.push(`%${String(q).trim()}%`); where.push(`(p.title ILIKE $${values.length} OR p.city ILIKE $${values.length} OR p.district ILIKE $${values.length})`); }
    let geoSelect = 'NULL::numeric AS distance_km';
    if (hasGeo) {
      const latParam=values.length+1; values.push(Number(lat));
      const lngParam=values.length+1; values.push(Number(lng));
      geoLatParam=latParam; geoLngParam=lngParam;
      const radiusParam=values.length+1; values.push(Math.min(Number(radiusKm),200));
      geoSelect = `(6371 * acos(LEAST(1, cos(radians($${latParam})) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians($${lngParam})) + sin(radians($${latParam})) * sin(radians(p.latitude))))) AS distance_km`;
      where.push(`p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND (6371 * acos(LEAST(1, cos(radians($${latParam})) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians($${lngParam})) + sin(radians($${latParam})) * sin(radians(p.latitude))))) <= $${radiusParam}`);
    }
    values.push(FX_BASE_CURRENCY); const fxBaseParam=values.length;
    values.push(searchCurrency); const displayCurrencyParam=values.length;
    const safePlacement=['homepage','search','featured','city'].includes(placement)?placement:'search';
    values.push(safePlacement); const placementParam=values.length;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    values.push(safeLimit);
    const limitParam=values.length;
    const result = await pool.query(`
      SELECT p.id,p.owner_id,p.office_id,p.title,p.is_demo,p.type,p.mode,p.city,p.district,p.price,p.currency,p.area,p.rooms,p.baths,p.description,p.image_url,p.featured,p.created_at,p.views_count,p.latitude,p.longitude,
        ROUND((p.price * COALESCE(rt.rate,1) / NULLIF(COALESCE(rf.rate,1),0))::numeric, 2) AS price_display,
        $${displayCurrencyParam}::varchar AS display_currency,
        ${geoSelect},
        CASE WHEN ad.id IS NULL THEN FALSE ELSE TRUE END AS sponsored,
        CASE WHEN ad.id IS NULL THEN NULL ELSE json_build_object('id',ad.id,'placement',ad.placement,'priority',ad.priority,'label',COALESCE(ad.title,'إعلان ممول'),'office_id',ad.office_id,'verified',COALESCE(o.verified,FALSE)) END AS ad,
        COALESCE((SELECT json_build_object('id',pv.id,'url',pv.url,'poster_url',pv.poster_url,'title',pv.title,'source_type',pv.source_type,'is_primary',pv.is_primary) FROM property_videos pv WHERE pv.property_id=p.id ORDER BY pv.is_primary DESC,pv.created_at DESC LIMIT 1), NULL) AS primary_video
      FROM properties p
      LEFT JOIN currency_rates rf ON rf.base_currency=$${fxBaseParam} AND rf.quote_currency=p.currency
      LEFT JOIN currency_rates rt ON rt.base_currency=$${fxBaseParam} AND rt.quote_currency=$${displayCurrencyParam}
      LEFT JOIN LATERAL (
        SELECT a.* FROM office_ads a
        WHERE a.property_id=p.id AND a.status='active'
          AND a.placement IN ($${placementParam},'featured')
          AND (a.starts_at IS NULL OR a.starts_at<=NOW())
          AND (a.ends_at IS NULL OR a.ends_at>NOW())
          AND (a.target_lat IS NULL OR (${hasGeo ? `6371 * acos(LEAST(1, cos(radians($${geoLatParam})) * cos(radians(a.target_lat)) * cos(radians(a.target_lng) - radians($${geoLngParam})) + sin(radians($${geoLatParam})) * sin(radians(a.target_lat)))) <= a.target_radius_km` : 'FALSE'}))
        ORDER BY CASE WHEN a.placement=$${placementParam} THEN 0 ELSE 1 END, a.priority DESC, a.budget DESC, a.created_at DESC
        LIMIT 1
      ) ad ON TRUE
      LEFT JOIN offices o ON o.id=ad.office_id
      ${where.length ? 'WHERE '+where.join(' AND ') : ''}
      ORDER BY CASE WHEN ad.id IS NOT NULL THEN 0 ELSE 1 END,
               COALESCE(ad.priority,0) DESC,
               COALESCE(ad.budget,0) DESC,
               ${hasGeo && safePlacement === 'search' ? 'distance_km ASC NULLS LAST,' : ''}
               p.featured DESC,
               p.created_at DESC
      LIMIT $${limitParam}`, values);
    let output=result.rows;
    if(req.query.includeOffices==='true'){
      const imported=await require('./office-search').searchOfficeListings(pool,{...req.query,currency:searchCurrency},getFxRate);
      output=[...output,...imported].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    }
    res.set('Cache-Control','no-store');
    res.json({ data: output, display_currency: searchCurrency, marketplace: true, placement: safePlacement, geo: hasGeo ? {lat:Number(lat),lng:Number(lng),radiusKm:Math.min(Number(radiusKm),200)} : null });
  } catch (error) { console.error(error); res.status(500).json({ error: 'تعذر تحميل العقارات' }); }
});

app.post('/api/ads/events', async (req,res)=>{
  const client=await pool.connect();
  try {
    const {ad_id,event_type,property_id}=req.body;
    if(!Number(ad_id) || !['impression','click','whatsapp'].includes(event_type)) return res.status(400).json({error:'بيانات الإعلان غير صحيحة'});
    await client.query('BEGIN');
    const ad=(await client.query(`SELECT a.*,o.id office_id FROM office_ads a JOIN offices o ON o.id=a.office_id WHERE a.id=$1 AND a.status='active' AND (a.starts_at IS NULL OR a.starts_at<=NOW()) AND (a.ends_at IS NULL OR a.ends_at>NOW()) FOR UPDATE`,[Number(ad_id)])).rows[0];
    if(!ad){await client.query('ROLLBACK');return res.status(404).json({error:'الإعلان غير نشط'});}
    const sessionKey=String(req.headers['x-session-key']||req.ip||'').slice(0,120);
    await client.query(`INSERT INTO ad_events(ad_id,property_id,event_type,session_key) VALUES($1,$2,$3,$4)`,[ad.id,ad.property_id||property_id||null,event_type,sessionKey]);
    let charge=0, units=0;
    if(event_type==='impression'){
      await client.query(`UPDATE office_ads SET impressions=impressions+1,last_impression_at=NOW() WHERE id=$1`,[ad.id]);
      if(ad.billing_model==='cpm' && Number(ad.bid)>0){ charge=Number(ad.bid)/1000; units=0.001; }
    } else if(event_type==='click'){
      await client.query(`UPDATE office_ads SET clicks=clicks+1,last_click_at=NOW() WHERE id=$1`,[ad.id]);
      if(ad.billing_model==='cpc' && Number(ad.bid)>0){ charge=Number(ad.bid); units=1; }
    } else {
      await client.query(`UPDATE office_ads SET whatsapp_clicks=whatsapp_clicks+1,last_whatsapp_at=NOW() WHERE id=$1`,[ad.id]);
    }
    if(charge>0){
      const wallet=(await client.query(`SELECT * FROM office_wallets WHERE office_id=$1 FOR UPDATE`,[ad.office_id])).rows[0];
      if(!wallet || Number(wallet.balance)<charge){
        await client.query(`UPDATE office_ads SET status='paused' WHERE id=$1`,[ad.id]);
        await client.query('COMMIT');
        return res.status(402).json({error:'رصيد المحفظة غير كافٍ، تم إيقاف الحملة تلقائياً'});
      }
      const newBalance=Number(wallet.balance)-charge;
      const tx=(await client.query(`UPDATE office_wallets SET balance=$1,updated_at=NOW() WHERE office_id=$2 RETURNING balance`,[newBalance,ad.office_id])).rows[0];
      const wtx=(await client.query(`INSERT INTO wallet_transactions(office_id,type,amount,balance_after,ad_id,description,metadata) VALUES($1,'ad_charge',$2,$3,$4,$5,$6) RETURNING id`,[ad.office_id,-charge,tx.balance,ad.id,event_type==='click'?'خصم نقرة من الإعلان':'خصم ظهور من الإعلان',JSON.stringify({event_type,billing_model:ad.billing_model,bid:Number(ad.bid),units})])).rows[0];
      const invoiceNo=`AQ-${new Date().getFullYear()}-${String(wtx.id).padStart(8,'0')}`;
      await client.query(`INSERT INTO ad_invoices(office_id,ad_id,wallet_transaction_id,invoice_no,description,amount,currency,billing_model,units,unit_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[ad.office_id,ad.id,wtx.id,invoiceNo,'استهلاك إعلاني - '+event_type,charge,wallet.currency,ad.billing_model,units,Number(ad.bid)]);
      await client.query(`UPDATE office_ads SET spent=spent+$1,last_charge_at=NOW() WHERE id=$2`,[charge,ad.id]);
    }
    await client.query('COMMIT'); res.json({ok:true,charged:charge});
  }catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'تعذر تسجيل التفاعل'});}finally{client.release();}
});

app.get('/api/office/marketplace', requireOfficeMember, async(req,res)=>{
  try{
    const [ads,summary]=await Promise.all([
      pool.query(`SELECT a.*,p.title property_title,p.city,p.district,o.verified FROM office_ads a JOIN properties p ON p.id=a.property_id JOIN offices o ON o.id=a.office_id WHERE a.office_id=$1 ORDER BY a.status,a.created_at DESC`,[req.office.id]),
      pool.query(`SELECT COUNT(*)::int campaigns,COALESCE(SUM(impressions),0)::int impressions,COALESCE(SUM(clicks),0)::int clicks,COALESCE(SUM(whatsapp_clicks),0)::int whatsapp_clicks,COALESCE(SUM(budget),0) budget,COALESCE(SUM(spent),0) spent FROM office_ads WHERE office_id=$1`,[req.office.id])
    ]);
    res.json({ads:ads.rows,summary:summary.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل سوق الإعلانات'});}
});

app.post('/api/office/ads/:id/publish', requireOfficeMember, async(req,res)=>{
  try{
    const r=await pool.query(`UPDATE office_ads SET status='active',starts_at=COALESCE(starts_at,NOW()),ends_at=COALESCE(ends_at,NOW()+INTERVAL '30 days') WHERE id=$1 AND office_id=$2 AND status IN ('pending','paused') RETURNING *`,[req.params.id,req.office.id]);
    if(!r.rows[0]) return res.status(404).json({error:'الإعلان غير موجود أو غير قابل للنشر'});
    res.json({data:r.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر نشر الإعلان'});}
});

app.get('/api/properties/:id', async (req, res) => {
  try { const result=await pool.query(`UPDATE properties SET views_count=views_count+1 WHERE id=$1 AND status='active' AND is_demo=FALSE RETURNING *`,[req.params.id]); if(!result.rows[0]) return res.status(404).json({error:'العقار غير موجود'}); const owner=await pool.query('SELECT id,name,phone,email,role,created_at FROM users WHERE id=$1',[result.rows[0].owner_id]); const imgs=await pool.query('SELECT id,url,sort_order FROM property_images WHERE property_id=$1 ORDER BY sort_order,id',[req.params.id]); const vids=await pool.query('SELECT id,url,poster_url,title,source_type,is_primary FROM property_videos WHERE property_id=$1 ORDER BY is_primary DESC,created_at DESC',[req.params.id]); const ad=await pool.query(`SELECT id,placement,priority,title FROM office_ads WHERE property_id=$1 AND status='active' AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>NOW()) ORDER BY priority DESC,budget DESC,created_at DESC LIMIT 1`,[req.params.id]); result.rows[0].images=imgs.rows; result.rows[0].videos=vids.rows; result.rows[0].owner=owner.rows[0]||null; result.rows[0].ad=ad.rows[0]||null; res.json({data:require('./listing-location').withFallbackLocation(result.rows[0])}); }
  catch(error){res.status(500).json({error:'تعذر تحميل العقار'});}
});

app.post('/api/properties/:id/inquiries', async (req,res)=>{
  try { const id=Number(req.params.id); const property=await pool.query("SELECT id,is_demo FROM properties WHERE id=$1 AND status='active'",[id]); if(!property.rows[0]) return res.status(404).json({error:'العقار غير موجود'}); if(property.rows[0].is_demo)return res.status(400).json({error:'هذا إعلان تجريبي ولا يستقبل استفسارات حقيقية'}); const user=await getCurrentUser(req); const name=String(req.body.name||user?.name||'').trim(), phone=String(req.body.phone||user?.phone||'').trim()||null, email=String(req.body.email||user?.email||'').trim()||null, message=String(req.body.message||'').trim(); if(name.length<2||message.length<3) return res.status(400).json({error:'الاسم والرسالة مطلوبان'}); const r=await pool.query('INSERT INTO inquiries(property_id,sender_id,sender_name,sender_phone,sender_email,message) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,user?.id||null,name,phone,email,message]); if(user?.id) await recordPropertyEvent(user.id,id,'inquiry').catch(()=>{}); res.status(201).json({data:r.rows[0]}); } catch(e){console.error(e);res.status(500).json({error:'تعذر إرسال الاستفسار'});}
});

app.post('/api/properties', requireAuth, async (req, res) => {
  try {
    const { title,type,mode='بيع',city,district='',price,currency='USD',area=null,rooms=null,baths=null,description='',latitude=null,longitude=null }=req.body;
    if(!title||!type||!city||price===undefined||price==='') return res.status(400).json({error:'العنوان والنوع والمدينة والسعر حقول مطلوبة'});
    if(!['بيع','إيجار'].includes(mode)) return res.status(400).json({error:'نوع العملية غير صحيح'});
    if(!['بيع','إيجار'].includes(mode))return res.status(400).json({error:'نوع العملية غير صحيح'});
    if([area,rooms,baths].some(v=>v!==null&&v!==''&&(!Number.isFinite(Number(v))||Number(v)<0)))return res.status(400).json({error:'المساحة وعدد الغرف والحمامات يجب أن تكون أرقامًا صالحة'});
    const propertyCurrency=String(currency||'USD').toUpperCase();
    if(!FX_SUPPORTED.includes(propertyCurrency)) return res.status(400).json({error:'عملة العقار غير مدعومة'});
    const hasLat=latitude!==null&&latitude!=='',hasLng=longitude!==null&&longitude!=='';
    if(hasLat!==hasLng||(hasLat&&(!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude))||Math.abs(Number(latitude))>90||Math.abs(Number(longitude))>180)))return res.status(400).json({error:'أدخل إحداثيين صالحين للموقع أو اتركهما فارغين'});
    if(!Number.isFinite(Number(price))||Number(price)<0)return res.status(400).json({error:'السعر غير صالح'});
    const office=await getOfficeForUser(req.user.id);
    if(office){ const sub=await officeSubscription(office.id); if(sub && sub.max_properties>=0){ const count=(await pool.query('SELECT COUNT(*)::int count FROM properties WHERE office_id=$1',[office.id])).rows[0].count; if(count>=sub.max_properties)return res.status(403).json({error:`الباقة تسمح بـ ${sub.max_properties} عقاراً فقط. قم بترقية الباقة.`}); } }
    const result=await pool.query(`INSERT INTO properties (owner_id,office_id,assigned_to,title,type,mode,city,district,price,currency,area,rooms,baths,description,latitude,longitude) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[req.user.id,office?.id||null,office?.id?req.user.id:null,title,type,mode,city,district,Number(price),propertyCurrency,area?Number(area):null,rooms?Number(rooms):null,baths?Number(baths):null,description,latitude!==null&&latitude!==''?Number(latitude):null,longitude!==null&&longitude!==''?Number(longitude):null]);
    await notifySavedSearchMatches(result.rows[0]);
    res.status(201).json({data:result.rows[0]});
  } catch(error){console.error(error);res.status(500).json({error:'تعذر حفظ العقار'});}
});

app.get('/api/offices/:slug', async (req,res)=>{try{const r=await pool.query(`SELECT o.*, (SELECT COUNT(*) FROM properties p WHERE p.office_id=o.id AND p.status='active')::int AS properties_count, (SELECT COUNT(*) FROM users u WHERE u.office_id=o.id AND u.is_active)::int AS staff_count FROM offices o WHERE o.slug=$1`,[req.params.slug]);if(!r.rows[0])return res.status(404).json({error:'المكتب غير موجود'});const p=await pool.query(`SELECT id,title,type,mode,city,district,price,currency,area,rooms,baths,image_url,featured,views_count FROM properties WHERE office_id=$1 AND status='active' ORDER BY featured DESC,created_at DESC LIMIT 100`,[r.rows[0].id]);res.json({office:r.rows[0],properties:p.rows});}catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل المكتب'});}});

// ---------------- Admin ----------------
// ---------------- Financial administration ----------------
app.get('/api/admin/finance/overview', requireAdmin, async (req,res)=>{
  try{
    const [totals,pending,recent,offices]=await Promise.all([
      pool.query(`SELECT COUNT(*)::int total_payments,COUNT(*) FILTER (WHERE status='paid')::int paid_payments,COUNT(*) FILTER (WHERE status='pending')::int pending_payments,COUNT(*) FILTER (WHERE status='failed')::int failed_payments,COUNT(*) FILTER (WHERE status='refunded')::int refunded_payments,COALESCE(SUM(amount) FILTER (WHERE status='paid'),0) paid_total,COALESCE(SUM(amount) FILTER (WHERE status='pending'),0) pending_total FROM payments`),
      pool.query(`SELECT p.id,p.amount,p.currency,p.provider,p.payment_method,p.review_status,p.transaction_reference,p.created_at,o.name office_name,u.name user_name FROM payments p LEFT JOIN offices o ON o.id=p.office_id LEFT JOIN users u ON u.id=p.user_id WHERE p.review_status='pending' ORDER BY p.created_at ASC LIMIT 100`),
      pool.query(`SELECT p.id,p.amount,p.currency,p.status,p.provider,p.payment_method,p.review_status,p.invoice_no,p.provider_payment_id,p.transaction_reference,p.created_at,p.paid_at,o.name office_name,u.name user_name FROM payments p LEFT JOIN offices o ON o.id=p.office_id LEFT JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 300`),
      pool.query(`SELECT o.id,o.name,o.city,COALESCE(w.balance,0) balance,COALESCE(w.currency,'USD') currency,COUNT(p.id)::int payment_count,COALESCE(SUM(p.amount) FILTER (WHERE p.status='paid'),0) paid_total FROM offices o LEFT JOIN office_wallets w ON w.office_id=o.id LEFT JOIN payments p ON p.office_id=o.id GROUP BY o.id,w.balance,w.currency ORDER BY paid_total DESC LIMIT 200`)
    ]);
    res.json({totals:totals.rows[0],pending:pending.rows,recent:recent.rows,offices:offices.rows});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل اللوحة المالية'});}
});

app.get('/api/admin/finance/payments', requireAdmin, async (req,res)=>{
  try{
    const q=String(req.query.q||'').trim(), provider=String(req.query.provider||'').trim(), status=String(req.query.status||'').trim();
    const vals=[],where=[];
    if(q){vals.push(`%${q}%`);where.push(`(o.name ILIKE $${vals.length} OR u.name ILIKE $${vals.length} OR u.email ILIKE $${vals.length} OR COALESCE(p.transaction_reference,'') ILIKE $${vals.length} OR COALESCE(p.provider_payment_id,'') ILIKE $${vals.length})`)}
    if(provider){vals.push(provider);where.push(`p.provider=$${vals.length}`)}
    if(status){vals.push(status);where.push(`p.status=$${vals.length}`)}
    const r=await pool.query(`SELECT p.*,o.name office_name,u.name user_name,u.email user_email,rv.name reviewer_name FROM payments p LEFT JOIN offices o ON o.id=p.office_id LEFT JOIN users u ON u.id=p.user_id LEFT JOIN users rv ON rv.id=p.reviewed_by ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY p.created_at DESC LIMIT 500`,vals);
    res.json({data:r.rows});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل المدفوعات'});}
});

app.patch('/api/admin/finance/payments/:id', requireAdmin, async (req,res)=>{
  const action=String(req.body.action||'');
  if(!['approve','reject','refund'].includes(action)) return res.status(400).json({error:'الإجراء غير صحيح'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const p=(await client.query(`SELECT p.*,o.owner_id FROM payments p LEFT JOIN offices o ON o.id=p.office_id WHERE p.id=$1 FOR UPDATE`,[req.params.id])).rows[0];
    if(!p){await client.query('ROLLBACK');return res.status(404).json({error:'عملية الدفع غير موجودة'});}
    if(action==='approve'){
      if(p.status==='paid'){await client.query('ROLLBACK');return res.json({ok:true,status:'paid',already:true});}
      if(!['shamcash','syriatel_cash'].includes(String(p.provider)) && p.review_status!=='pending'){await client.query('ROLLBACK');return res.status(400).json({error:'هذه العملية لا تحتاج اعتماداً يدوياً'});}
      const meta=p.metadata||{};
      if(meta.kind==='wallet_topup'){
        await client.query(`INSERT INTO office_wallets(office_id,currency) VALUES($1,$2) ON CONFLICT (office_id) DO NOTHING`,[p.office_id,p.currency]);
        const w=(await client.query(`SELECT * FROM office_wallets WHERE office_id=$1 FOR UPDATE`,[p.office_id])).rows[0];
        if(String(w.currency)!==String(p.currency)){await client.query('ROLLBACK');return res.status(400).json({error:'عملة المحفظة لا تطابق عملة التحويل'});}
        const balance=Number(w.balance)+Number(p.amount);
        const nw=(await client.query(`UPDATE office_wallets SET balance=$1,updated_at=NOW() WHERE office_id=$2 RETURNING balance`,[balance,p.office_id])).rows[0];
        await client.query(`UPDATE payments SET status='paid',paid_at=NOW(),review_status='approved',reviewed_by=$2,reviewed_at=NOW(),invoice_no=COALESCE(invoice_no,$3) WHERE id=$1`,[p.id,req.user.id,newFinanceInvoiceNo()]);
        await client.query(`INSERT INTO wallet_transactions(office_id,type,amount,balance_after,payment_id,description,metadata) VALUES($1,'topup',$2,$3,$4,$5,$6)`,[p.office_id,p.amount,nw.balance,p.id,`شحن المحفظة عبر ${p.provider}`,JSON.stringify({manual_review:true,provider:p.provider,reference:p.transaction_reference||null})]);
      } else {
        await client.query(`UPDATE payments SET status='paid',paid_at=NOW(),review_status='approved',reviewed_by=$2,reviewed_at=NOW(),invoice_no=COALESCE(invoice_no,$3) WHERE id=$1`,[p.id,req.user.id,newFinanceInvoiceNo()]);
      }
      await client.query('COMMIT'); return res.json({ok:true,status:'paid'});
    }
    if(action==='reject'){
      if(p.status==='paid'){await client.query('ROLLBACK');return res.status(400).json({error:'لا يمكن رفض عملية مدفوعة'});}
      await client.query(`UPDATE payments SET status='cancelled',review_status='rejected',reviewed_by=$2,reviewed_at=NOW(),metadata=metadata||$3::jsonb WHERE id=$1`,[p.id,req.user.id,JSON.stringify({rejection_reason:String(req.body.reason||'مرفوض من الإدارة')})]);
      await client.query('COMMIT'); return res.json({ok:true,status:'cancelled'});
    }
    if(p.status!=='paid'){await client.query('ROLLBACK');return res.status(400).json({error:'لا يمكن استرداد عملية غير مدفوعة'});}
    await client.query(`UPDATE payments SET status='refunded',reviewed_by=$2,reviewed_at=NOW(),metadata=metadata||$3::jsonb WHERE id=$1`,[p.id,req.user.id,JSON.stringify({refund_reason:String(req.body.reason||'استرداد من الإدارة')})]);
    if(p.metadata?.kind==='wallet_topup'){
      await client.query(`INSERT INTO office_wallets(office_id,currency) VALUES($1,$2) ON CONFLICT (office_id) DO NOTHING`,[p.office_id,p.currency]);
      const w=(await client.query(`SELECT * FROM office_wallets WHERE office_id=$1 FOR UPDATE`,[p.office_id])).rows[0];
      const newBal=Number(w.balance)-Number(p.amount); if(newBal<0){await client.query('ROLLBACK');return res.status(400).json({error:'الرصيد الحالي لا يسمح بالاسترداد'});}
      const nw=(await client.query(`UPDATE office_wallets SET balance=$1,updated_at=NOW() WHERE office_id=$2 RETURNING balance`,[newBal,p.office_id])).rows[0];
      await client.query(`INSERT INTO wallet_transactions(office_id,type,amount,balance_after,payment_id,description,metadata) VALUES($1,'refund',$2,$3,$4,'استرداد عملية دفع',$5)`,[p.office_id,-Number(p.amount),nw.balance,p.id,JSON.stringify({admin_refund:true})]);
    }
    await client.query('COMMIT'); return res.json({ok:true,status:'refunded'});
  }catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({error:'تعذر تنفيذ الإجراء المالي'});}finally{client.release();}
});

app.get('/api/admin/finance/statement/:officeId', requireAdmin, async (req,res)=>{
  try{
    const office=(await pool.query(`SELECT o.id,o.name,o.city,o.district,o.address,u.name owner_name,u.email owner_email FROM offices o LEFT JOIN users u ON u.id=o.owner_id WHERE o.id=$1`,[req.params.officeId])).rows[0];
    if(!office)return res.status(404).json({error:'المكتب غير موجود'});
    const [wallet,tx,payments,invoices]=await Promise.all([
      pool.query(`SELECT * FROM office_wallets WHERE office_id=$1`,[office.id]),
      pool.query(`SELECT * FROM wallet_transactions WHERE office_id=$1 ORDER BY created_at DESC LIMIT 500`,[office.id]),
      pool.query(`SELECT * FROM payments WHERE office_id=$1 ORDER BY created_at DESC LIMIT 500`,[office.id]),
      pool.query(`SELECT i.*,a.title campaign_title,p.title property_title FROM ad_invoices i LEFT JOIN office_ads a ON a.id=i.ad_id LEFT JOIN properties p ON p.id=a.property_id WHERE i.office_id=$1 ORDER BY i.created_at DESC LIMIT 500`,[office.id])
    ]);
    res.json({office,wallet:wallet.rows[0]||null,transactions:tx.rows,payments:payments.rows,invoices:invoices.rows});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل كشف حساب المكتب'});}
});

function escPdf(s){return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function invoiceHtml(data){
  const p=data.payment, o=data.office;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font-family:Arial,'DejaVu Sans',sans-serif;color:#172033;direction:rtl}h1{font-size:28px;margin:0 0 8px}.brand{font-size:24px;font-weight:bold}.meta{display:flex;justify-content:space-between;border-bottom:2px solid #123b70;padding-bottom:14px;margin-bottom:24px}.box{border:1px solid #d9e0ea;border-radius:12px;padding:16px;margin:14px 0}.row{display:flex;justify-content:space-between;padding:7px 0}.total{font-size:22px;font-weight:bold;border-top:2px solid #123b70;margin-top:12px;padding-top:12px}.muted{color:#657087}</style></head><body><div class="meta"><div><div class="brand">عقارتكم</div><div class="muted">فاتورة مالية إلكترونية</div></div><div><b>${escPdf(p.invoice_no||'—')}</b><br>${new Date(p.created_at).toLocaleString('ar-SY')}</div></div><h1>فاتورة دفع</h1><div class="box"><div class="row"><span>المكتب</span><b>${escPdf(o.name||'—')}</b></div><div class="row"><span>صاحب المكتب</span><b>${escPdf(o.owner_name||'—')}</b></div><div class="row"><span>طريقة الدفع</span><b>${escPdf(p.provider||'—')}</b></div><div class="row"><span>رقم العملية</span><b>${escPdf(p.provider_payment_id||p.transaction_reference||'—')}</b></div><div class="row"><span>الحالة</span><b>${escPdf(p.status||'—')}</b></div></div><div class="box"><div class="row"><span>الوصف</span><b>${p.metadata?.kind==='wallet_topup'?'شحن المحفظة الإعلانية':'اشتراك مكتب'}</b></div><div class="row total"><span>الإجمالي</span><span>${Number(p.amount).toLocaleString('ar-SY')} ${escPdf(p.currency)}</span></div></div><p class="muted">تم إصدار هذه الفاتورة إلكترونياً من منصة عقارتكم.</p></body></html>`;
}
app.get('/api/admin/finance/payments/:id/invoice.pdf', requireAdmin, async(req,res)=>{
  try{
    const r=await pool.query(`SELECT p.*,o.name office_name,o.city,o.district,o.address,u.name owner_name,u.email owner_email FROM payments p LEFT JOIN offices o ON o.id=p.office_id LEFT JOIN users u ON u.id=o.owner_id WHERE p.id=$1`,[req.params.id]);
    const pmt=r.rows[0]; if(!pmt)return res.status(404).json({error:'الفاتورة غير موجودة'});
    if(!pmt.invoice_no) pmt.invoice_no=newFinanceInvoiceNo();
    if(!r.rows[0].invoice_no) await pool.query(`UPDATE payments SET invoice_no=$2 WHERE id=$1 AND invoice_no IS NULL`,[pmt.id,pmt.invoice_no]);
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aqartkom-invoice-')), html=path.join(dir,'invoice.html'), pdf=path.join(dir,'invoice.pdf');
    fs.writeFileSync(html,invoiceHtml({payment:pmt,office:{name:pmt.office_name,owner_name:pmt.owner_name}}));
    execFile('/usr/bin/chromium',['--headless','--no-sandbox','--disable-gpu',`--print-to-pdf=${pdf}`,`file://${html}`],{timeout:30000},(err)=>{if(err){console.error(err);return res.status(500).json({error:'تعذر إنشاء PDF على الخادم'});}res.download(pdf,`${pmt.invoice_no}.pdf`,()=>{try{fs.rmSync(dir,{recursive:true,force:true})}catch(_e){}});});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر إصدار الفاتورة'});}
});

app.get('/api/admin/overview', requireAdmin, async (_req,res)=>{
  try{
    const [users,properties,inquiries,views]=await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active, COUNT(*) FILTER (WHERE role='agent')::int AS agents, COUNT(*) FILTER (WHERE role='admin')::int AS admins FROM users`),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active, COUNT(*) FILTER (WHERE status='pending')::int AS pending, COUNT(*) FILTER (WHERE featured)::int AS featured FROM properties`),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='new')::int AS new FROM inquiries`),
      pool.query(`SELECT COALESCE(SUM(views_count),0)::int AS total FROM properties`)
    ]);
    res.json({users:users.rows[0],properties:properties.rows[0],inquiries:inquiries.rows[0],views:views.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل إحصائيات الإدارة'});}
});
app.get('/api/admin/users', requireAdmin, async (req,res)=>{ const q=String(req.query.q||'').trim(); const vals=[]; let where=''; if(q){vals.push(`%${q}%`);where='WHERE name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1';} const r=await pool.query(`SELECT id,name,email,phone,role,is_active,created_at,(SELECT COUNT(*) FROM properties p WHERE p.owner_id=users.id)::int AS properties_count FROM users ${where} ORDER BY created_at DESC LIMIT 200`,vals); res.json({data:r.rows}); });
app.patch('/api/admin/users/:id', requireAdmin, async (req,res)=>{ if(String(req.params.id)===String(req.user.id))return res.status(403).json({error:'لا يمكن تغيير صلاحيات حسابك من هنا'}); const target=(await pool.query('SELECT email FROM users WHERE id=$1',[req.params.id])).rows[0];if(target && normalizeEmail(target.email)===normalizeEmail(process.env.ADMIN_EMAIL))return res.status(403).json({error:'حساب المالك محمي'}); const role=String(req.body.role||''); const active=typeof req.body.is_active==='boolean'?req.body.is_active:null; if(role && !['user','agent','admin'].includes(role)) return res.status(400).json({error:'الدور غير صحيح'}); const r=await pool.query(`UPDATE users SET role=COALESCE($1,role), is_active=COALESCE($2,is_active), updated_at=NOW() WHERE id=$3 RETURNING id,name,email,phone,role,is_active,created_at`,[role||null,active,req.params.id]); if(!r.rows[0])return res.status(404).json({error:'المستخدم غير موجود'}); res.json({data:r.rows[0]}); });
app.get('/api/admin/properties', requireAdmin, async (req,res)=>{ const q=String(req.query.q||'').trim(); const status=String(req.query.status||'').trim(); const vals=[]; const where=[]; if(q){vals.push(`%${q}%`);where.push(`(p.title ILIKE $${vals.length} OR p.city ILIKE $${vals.length} OR p.district ILIKE $${vals.length})`)} if(status){vals.push(status);where.push(`p.status=$${vals.length}`)} const r=await pool.query(`SELECT p.*,u.name owner_name,u.phone owner_phone,(SELECT COUNT(*) FROM inquiries i WHERE i.property_id=p.id)::int inquiry_count FROM properties p LEFT JOIN users u ON u.id=p.owner_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY p.created_at DESC LIMIT 300`,vals);res.json({data:r.rows}); });
app.patch('/api/admin/properties/:id', requireAdmin, async (req,res)=>{ const status=req.body.status; const featured=req.body.featured; if(status!==undefined&&!['pending','active','rejected'].includes(status))return res.status(400).json({error:'حالة الإعلان غير صحيحة'}); const r=await pool.query(`UPDATE properties SET status=COALESCE($1,status), featured=COALESCE($2,featured) WHERE id=$3 RETURNING *`,[status===undefined?null:status,featured===undefined?null:Boolean(featured),req.params.id]);if(!r.rows[0])return res.status(404).json({error:'العقار غير موجود'});res.json({data:r.rows[0]}); });
app.delete('/api/admin/properties/:id', requireAdmin, async (req,res)=>{ const r=await pool.query('DELETE FROM properties WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rows[0])return res.status(404).json({error:'العقار غير موجود'});res.json({ok:true}); });
app.get('/api/admin/inquiries', requireAdmin, async (_req,res)=>{ const r=await pool.query(`SELECT i.*,p.title property_title,u.name owner_name FROM inquiries i JOIN properties p ON p.id=i.property_id LEFT JOIN users u ON u.id=p.owner_id ORDER BY i.created_at DESC LIMIT 300`);res.json({data:r.rows}); });


require('./marei-listings').registerMareiListings(app,pool);
require('./office-videos')(app,{pool,requireAdmin,uploadDir});

// ===== مراقبة السوق العقاري السوري / Meta =====
function marketToken(){ return process.env.META_MARKET_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN || ''; }
function normalizeMarketText(v){ return String(v||'').replace(/\s+/g,' ').trim(); }
function extractMarketListing(text, sourceName){
  const t=normalizeMarketText(text);
  const phones=[...t.matchAll(/(?:\+?963|00963|0)?9\d{8}/g)].map(m=>m[0]).filter(Boolean);
  const priceMatch=t.match(/(?:السعر|المطلوب|المبلغ|بسعر|سعره)\s*[:：-]?\s*([\d٠-٩.,]+)\s*(دولار|دولر|USD|\$|ل\.س|ليرة سورية|ليرة|SYP|ريال|SAR|درهم|AED|يورو|EUR)?/i) || t.match(/([\d٠-٩][\d٠-٩.,]{2,})\s*(دولار|دولر|USD|\$|ل\.س|ليرة سورية|ليرة|SYP|ريال|SAR|درهم|AED|يورو|EUR)/i);
  const n=(x)=>Number(String(x||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/,/g,'').replace(/\./g,m=>m));
  let price=priceMatch?n(priceMatch[1]):null;
  let currency=priceMatch&&priceMatch[2]?priceMatch[2].toUpperCase():null;
  if(currency==='دولار'||currency==='دولر'||currency==='$') currency='USD';
  if(currency==='ل.س'||currency==='ليرة'||currency==='ليرة سورية') currency='SYP';
  if(currency==='ريال') currency='SAR'; if(currency==='درهم') currency='AED'; if(currency==='يورو') currency='EUR';
  const areaMatch=t.match(/(\d+(?:[.,]\d+)?)\s*(?:م2|م²|متر مربع|متر²)/i);
  const roomsMatch=t.match(/(\d+)\s*(?:غرف|غرفة|نوم|نومات)/i);
  const type=t.match(/شقة|فيلا|بيت|منزل|أرض|ارض|محل|مكتب|مزرعة|شاليه|مستودع|عمارة|بناء/i);
  const mode=/للإيجار|إيجار|ايجار|أجار/i.test(t)?'rent':(/للبيع|بيع|مطلوب شراء/i.test(t)?'sale':null);
  const cities=['دمشق','ريف دمشق','حلب','حمص','حماة','اللاذقية','طرطوس','درعا','السويداء','القنيطرة','دير الزور','الرقة','الحسكة','إدلب'];
  const city=cities.find(c=>t.includes(c))||null;
  const districts=['المزة','كفرسوسة','الميدان','برزة','ركن الدين','المهاجرين','دمر','المالكي','أبو رمانة','جرمانا','صحنايا','قدسيا','الزاهرة','القصاع','المزرعة'];
  const district=districts.find(c=>t.includes(c))||null;
  return {advertiser_name:sourceName,title:(t.split(/[\n.!؟]/)[0]||'إعلان عقاري').slice(0,300),description:t,phone:phones[0]||null,whatsapp:phones[0]||null,city,district,property_type:type?type[0]:null,listing_mode:mode,price,currency,area:areaMatch?Number(areaMatch[1].replace(',','.')):null,rooms:roomsMatch?Number(roomsMatch[1]):null};
}
async function graphGet(url){
  const token=marketToken(); if(!token) throw new Error('META_MARKET_ACCESS_TOKEN غير مضبوط');
  const u=new URL(url); u.searchParams.set('access_token',token); const r=await fetch(u); const data=await r.json(); if(!r.ok||data.error) throw new Error(data.error?.message||`Meta API ${r.status}`); return data;
}
async function fetchFacebookSource(src, limit=100){
  if(!src.page_id) return [];
  const fields='id,message,created_time,permalink_url,full_picture,attachments{media_type,media,target}';
  const u=`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION||'v23.0'}/${encodeURIComponent(src.page_id)}/posts?fields=${encodeURIComponent(fields)}&limit=${Math.min(limit,100)}`;
  const data=await graphGet(u); return (data.data||[]).map(x=>({external_id:x.id,external_url:x.permalink_url||null,text:x.message||'',created_time:x.created_time,media:x.full_picture?[{url:x.full_picture,type:'image'}]:[]}));
}
async function fetchInstagramSource(src, limit=100){
  if(!src.account_id) return [];
  const fields='id,caption,media_type,media_url,permalink,timestamp,thumbnail_url';
  const u=`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION||'v23.0'}/${encodeURIComponent(src.account_id)}/media?fields=${encodeURIComponent(fields)}&limit=${Math.min(limit,100)}`;
  const data=await graphGet(u); return (data.data||[]).map(x=>({external_id:x.id,external_url:x.permalink||null,text:x.caption||'',created_time:x.timestamp,media:(x.media_url||x.thumbnail_url)?[{url:x.media_url||x.thumbnail_url,type:String(x.media_type||'').toLowerCase()}]:[]}));
}
async function marketSync(){
  const sources=(await pool.query('SELECT * FROM market_sources WHERE is_active=TRUE ORDER BY id')).rows;
  let imported=0, duplicates=0, errors=0;
  const dailyLimit=Number(process.env.MARKET_DAILY_LIMIT||1000);
  const today=(await pool.query(`SELECT COUNT(*)::int c FROM market_listings WHERE created_at::date=CURRENT_DATE`)).rows[0].c;
  if(today>=dailyLimit) return {imported:0,duplicates:0,errors:0,limitReached:true};
  for(const src of sources){
    if(imported>=dailyLimit) break;
    const run=(await pool.query('INSERT INTO market_ingestion_runs(source_id) VALUES($1) RETURNING id',[src.id])).rows[0].id;
    try{
      const rows=src.platform==='facebook'?await fetchFacebookSource(src,100):await fetchInstagramSource(src,100);
      let ri=0,rd=0;
      for(const item of rows){
        if(imported>=dailyLimit) break;
        const exists=await pool.query('SELECT id FROM market_listings WHERE platform=$1 AND external_id=$2',[src.platform,item.external_id]);
        const parsed=extractMarketListing(item.text,src.name);
        if(exists.rows[0]){await pool.query(`UPDATE market_listings SET last_seen_at=NOW(),description=COALESCE(NULLIF($1,''),description),media=CASE WHEN $2::jsonb <> '[]'::jsonb THEN $2::jsonb ELSE media END,updated_at=NOW() WHERE id=$3`,[parsed.description,JSON.stringify(item.media||[]),exists.rows[0].id]);duplicates++;rd++;continue;}
        await pool.query(`INSERT INTO market_listings(source_id,platform,external_id,external_url,advertiser_name,title,description,phone,whatsapp,city,district,property_type,listing_mode,price,currency,area,rooms,media,raw_data,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)`,[src.id,src.platform,item.external_id,item.external_url,parsed.advertiser_name,parsed.title,parsed.description,parsed.phone,parsed.whatsapp,parsed.city,parsed.district,parsed.property_type,parsed.listing_mode,parsed.price,parsed.currency,parsed.area,parsed.rooms,JSON.stringify(item.media||[]),JSON.stringify(item),item.created_time?new Date(item.created_time):new Date()]); imported++;ri++;
      }
      await pool.query(`UPDATE market_ingestion_runs SET finished_at=NOW(),status='success',fetched_count=$1,imported_count=$2,duplicate_count=$3 WHERE id=$4`,[rows.length,ri,rd,run]);
      await pool.query('UPDATE market_sources SET last_synced_at=NOW(),updated_at=NOW() WHERE id=$1',[src.id]);
    }catch(e){errors++;await pool.query(`UPDATE market_ingestion_runs SET finished_at=NOW(),status='error',error_count=1,error_message=$1 WHERE id=$2`,[String(e.message).slice(0,1000),run]);}
  }
  return {imported,duplicates,errors,limitReached:imported>=dailyLimit};
}
app.get('/api/admin/market/sources',requireAdmin,async(_req,res)=>{try{const r=await pool.query(`SELECT * FROM market_sources ORDER BY created_at DESC`);res.json({data:r.rows});}catch(e){res.status(500).json({error:'تعذر تحميل المصادر'});}});
app.post('/api/admin/market/sources',requireAdmin,async(req,res)=>{try{const platform=String(req.body.platform||'').toLowerCase();const name=String(req.body.name||'').trim();const page_id=req.body.page_id?String(req.body.page_id):null;const account_id=req.body.account_id?String(req.body.account_id):null;if(!['facebook','instagram'].includes(platform)||!name||(platform==='facebook'&&!page_id)||(platform==='instagram'&&!account_id))return res.status(400).json({error:'بيانات المصدر غير مكتملة'});const r=await pool.query(`INSERT INTO market_sources(platform,name,page_id,account_id,page_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *`,[platform,name,page_id,account_id,req.body.page_url||null]);res.json({data:r.rows[0]||null});}catch(e){res.status(500).json({error:'تعذر إضافة المصدر'});}});
app.delete('/api/admin/market/sources/:id',requireAdmin,async(req,res)=>{try{await pool.query('UPDATE market_sources SET is_active=FALSE,updated_at=NOW() WHERE id=$1',[req.params.id]);res.json({ok:true});}catch(e){res.status(500).json({error:'تعذر إيقاف المصدر'});}});
app.get('/api/admin/market/listings',requireAdmin,async(req,res)=>{try{const status=String(req.query.status||'pending');const vals=[];let where='';if(status&&status!=='all'){vals.push(status);where='WHERE m.status=$1';}const r=await pool.query(`SELECT m.*,s.name source_name FROM market_listings m LEFT JOIN market_sources s ON s.id=m.source_id ${where} ORDER BY m.last_seen_at DESC LIMIT 500`,vals);res.json({data:r.rows});}catch(e){res.status(500).json({error:'تعذر تحميل الإعلانات المستوردة'});}});
app.patch('/api/admin/market/listings/:id',requireAdmin,async(req,res)=>{try{const status=String(req.body.status||'');if(!['pending','approved','rejected','published','duplicate'].includes(status))return res.status(400).json({error:'حالة غير صحيحة'});const r=await pool.query('UPDATE market_listings SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[status,req.params.id]);if(!r.rows[0])return res.status(404).json({error:'الإعلان غير موجود'});res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:'تعذر تحديث الإعلان'});}});
app.post('/api/admin/market/sync',requireAdmin,async(_req,res)=>{try{const x=await marketSync();res.json(x);}catch(e){res.status(500).json({error:e.message||'تعذر تشغيل المزامنة'});}});
app.get('/api/admin/market/runs',requireAdmin,async(_req,res)=>{try{const r=await pool.query(`SELECT r.*,s.name source_name FROM market_ingestion_runs r LEFT JOIN market_sources s ON s.id=r.source_id ORDER BY r.started_at DESC LIMIT 100`);res.json({data:r.rows});}catch(e){res.status(500).json({error:'تعذر تحميل سجل المزامنة'});}});
// The regional scheduler owns automatic discovery at 18:00 and 23:00 Damascus.
// Existing authorized Meta sources remain available through the manual sync route.
await require('./regional-agents').register(app,{pool,requireAdmin});


// ---------------- V27 hotel payments, collections and discrepancy detection ----------------
async function refreshPaymentInvoice(hotelId, financialId){
 const f=(await pool.query(`SELECT * FROM hotel_ota_financials WHERE id=$1 AND hotel_id=$2`,[financialId,hotelId])).rows[0]; if(!f)return null;
 const received=(await pool.query(`SELECT COALESCE(SUM(CASE WHEN entry_type='ota_payout_received' AND direction='credit' THEN amount ELSE 0 END),0) v FROM hotel_payment_ledger WHERE hotel_id=$1 AND ota_financial_id=$2`,[hotelId,financialId])).rows[0].v;
 const collected=(await pool.query(`SELECT COALESCE(SUM(CASE WHEN entry_type='guest_payment' AND direction='credit' THEN amount ELSE 0 END),0) v FROM hotel_payment_ledger WHERE hotel_id=$1 AND ota_financial_id=$2`,[hotelId,financialId])).rows[0].v;
 const payoutVariance=Number(received)-Number(f.payout_amount), collectionVariance=Number(collected)-Number(f.amount_to_collect);
 const status=Math.abs(payoutVariance)<0.01&&Math.abs(collectionVariance)<0.01?'matched':(Number(received)>0||Number(collected)>0?'partial':'open');
 const no=`AQI-${String(hotelId).padStart(4,'0')}-${String(f.id).padStart(7,'0')}`;
 const q=await pool.query(`INSERT INTO hotel_payment_invoices(hotel_id,local_booking_id,ota_financial_id,invoice_number,provider,external_booking_id,currency,gross_amount,commission_amount,fees_amount,taxes_amount,expected_payout,received_payout,guest_collect_expected,guest_collected,payout_variance,collection_variance,status,due_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,CURRENT_DATE) ON CONFLICT(provider,external_booking_id) DO UPDATE SET local_booking_id=EXCLUDED.local_booking_id,ota_financial_id=EXCLUDED.ota_financial_id,currency=EXCLUDED.currency,gross_amount=EXCLUDED.gross_amount,commission_amount=EXCLUDED.commission_amount,fees_amount=EXCLUDED.fees_amount,taxes_amount=EXCLUDED.taxes_amount,expected_payout=EXCLUDED.expected_payout,received_payout=EXCLUDED.received_payout,guest_collect_expected=EXCLUDED.guest_collect_expected,guest_collected=EXCLUDED.guest_collected,payout_variance=EXCLUDED.payout_variance,collection_variance=EXCLUDED.collection_variance,status=EXCLUDED.status,updated_at=NOW() RETURNING *`,[hotelId,f.local_booking_id,f.id,no,f.provider,f.external_booking_id,f.currency,f.gross_amount,f.commission_amount,f.charges_amount,f.taxes_amount,f.payout_amount,received,f.amount_to_collect,collected,payoutVariance,collectionVariance,status]);
 const inv=q.rows[0];
 await pool.query(`DELETE FROM hotel_payment_alerts WHERE invoice_id=$1 AND resolved_at IS NULL`,[inv.id]);
 const threshold=0.01;
 if(Math.abs(payoutVariance)>threshold)await pool.query(`INSERT INTO hotel_payment_alerts(hotel_id,invoice_id,alert_type,severity,message,amount,currency) VALUES($1,$2,'payout_variance',$3,$4,$5,$6) ON CONFLICT(invoice_id,alert_type) DO UPDATE SET severity=EXCLUDED.severity,message=EXCLUDED.message,amount=EXCLUDED.amount,currency=EXCLUDED.currency,resolved_at=NULL,created_at=NOW()`,[hotelId,inv.id,Math.abs(payoutVariance)>10?'high':'warning',`فرق دفعة OTA: المتوقع ${f.payout_amount} والمستلم ${received}`,payoutVariance,f.currency]);
 if(Math.abs(collectionVariance)>threshold)await pool.query(`INSERT INTO hotel_payment_alerts(hotel_id,invoice_id,alert_type,severity,message,amount,currency) VALUES($1,$2,'collection_variance',$3,$4,$5,$6) ON CONFLICT(invoice_id,alert_type) DO UPDATE SET severity=EXCLUDED.severity,message=EXCLUDED.message,amount=EXCLUDED.amount,currency=EXCLUDED.currency,resolved_at=NULL,created_at=NOW()`,[hotelId,inv.id,Math.abs(collectionVariance)>10?'high':'warning',`فرق تحصيل الضيف: المتوقع ${f.amount_to_collect} والمحصّل ${collected}`,collectionVariance,f.currency]);
 return inv;
}
app.post('/api/office/hotels/:id/payments/rebuild',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const fs=(await pool.query(`SELECT id FROM hotel_ota_financials WHERE hotel_id=$1 ORDER BY id`,[req.params.id])).rows;let n=0;for(const f of fs){await refreshPaymentInvoice(Number(req.params.id),f.id);n++;}res.json({processed:n});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/office/hotels/:id/payments',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const id=Number(req.params.id);const summary=(await pool.query(`SELECT COUNT(*)::int invoices,COALESCE(SUM(expected_payout),0) expected_payout,COALESCE(SUM(received_payout),0) received_payout,COALESCE(SUM(guest_collect_expected),0) guest_expected,COALESCE(SUM(guest_collected),0) guest_collected,COALESCE(SUM(ABS(payout_variance)),0) payout_variance,COALESCE(SUM(ABS(collection_variance)),0) collection_variance FROM hotel_payment_invoices WHERE hotel_id=$1`,[id])).rows[0];const invoices=(await pool.query(`SELECT i.*,b.booking_code,b.guest_name FROM hotel_payment_invoices i LEFT JOIN hotel_bookings b ON b.id=i.local_booking_id WHERE i.hotel_id=$1 ORDER BY i.updated_at DESC LIMIT 250`,[id])).rows;const alerts=(await pool.query(`SELECT a.*,i.invoice_number,i.external_booking_id,i.provider FROM hotel_payment_alerts a JOIN hotel_payment_invoices i ON i.id=a.invoice_id WHERE a.hotel_id=$1 AND a.resolved_at IS NULL ORDER BY CASE a.severity WHEN 'high' THEN 1 ELSE 2 END,a.created_at DESC`,[id])).rows;res.json({summary,invoices,alerts});}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/office/hotels/:id/payments/entries',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const b=req.body||{};const inv=(await pool.query(`SELECT * FROM hotel_payment_invoices WHERE id=$1 AND hotel_id=$2`,[b.invoice_id,req.params.id])).rows[0];if(!inv)return res.status(404).json({error:'الفاتورة غير موجودة'});if(!['guest_payment','ota_payout_received','refund','adjustment'].includes(b.entry_type))return res.status(400).json({error:'نوع الحركة غير صحيح'});const amount=Number(b.amount);if(!(amount>0))return res.status(400).json({error:'المبلغ يجب أن يكون أكبر من صفر'});const direction=b.entry_type==='refund'?'debit':'credit';const r=await pool.query(`INSERT INTO hotel_payment_ledger(hotel_id,local_booking_id,ota_financial_id,provider,external_booking_id,entry_type,direction,amount,currency,reference,payment_method,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[req.params.id,inv.local_booking_id,inv.ota_financial_id,inv.provider,inv.external_booking_id,b.entry_type,direction,amount,inv.currency,b.reference||null,b.payment_method||null,b.notes||null]);await refreshPaymentInvoice(Number(req.params.id),inv.ota_financial_id);res.json({data:r.rows[0]});}catch(e){res.status(500).json({error:e.message});}});
app.get('/api/office/hotels/:id/payments/ledger',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=await pool.query(`SELECT l.*,i.invoice_number FROM hotel_payment_ledger l LEFT JOIN hotel_payment_invoices i ON i.ota_financial_id=l.ota_financial_id AND i.hotel_id=l.hotel_id WHERE l.hotel_id=$1 ORDER BY l.occurred_at DESC LIMIT 500`,[req.params.id]);res.json({data:r.rows});}catch(e){res.status(500).json({error:e.message});}});
app.patch('/api/office/hotels/:id/payments/alerts/:aid',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=await pool.query(`UPDATE hotel_payment_alerts SET resolved_at=NOW() WHERE id=$1 AND hotel_id=$2 RETURNING *`,[req.params.aid,req.params.id]);res.json({data:r.rows[0]||null});}catch(e){res.status(500).json({error:e.message});}});


// ---------------- V28 central hotel executive dashboard ----------------
app.get('/api/admin/hotels/executive-dashboard', requireAdmin, async (req,res)=>{
 try{
  const days=Math.min(3650,Math.max(1,Number(req.query.days||30)));
  const kpis=(await pool.query(`SELECT
    (SELECT COUNT(*) FROM hotels)::int hotels,
    (SELECT COUNT(*) FROM hotel_bookings WHERE created_at>=NOW()-($1||' days')::interval)::int bookings,
    (SELECT COALESCE(SUM(total),0) FROM hotel_bookings WHERE created_at>=NOW()-($1||' days')::interval AND status<>'cancelled') gross_booking_value,
    (SELECT COALESCE(SUM(commission_amount),0) FROM hotel_bookings WHERE created_at>=NOW()-($1||' days')::interval AND status<>'cancelled') platform_commission,
    (SELECT COALESCE(SUM(net_amount),0) FROM hotel_bookings WHERE created_at>=NOW()-($1||' days')::interval AND status<>'cancelled') hotel_net,
    (SELECT COALESCE(SUM(received_payout),0) FROM hotel_payment_invoices WHERE updated_at>=NOW()-($1||' days')::interval) ota_received,
    (SELECT COALESCE(SUM(guest_collected),0) FROM hotel_payment_invoices WHERE updated_at>=NOW()-($1||' days')::interval) guest_collected,
    (SELECT COALESCE(SUM(ABS(payout_variance)+ABS(collection_variance)),0) FROM hotel_payment_invoices WHERE updated_at>=NOW()-($1||' days')::interval) discrepancies,
    (SELECT COUNT(*) FROM hotel_payment_alerts WHERE resolved_at IS NULL)::int open_alerts`,[days])).rows[0];
  const hotels=(await pool.query(`SELECT h.id,h.name,h.city,b.currency,h.platform_commission_rate AS platform_commission_percent,
    COUNT(DISTINCT b.id)::int bookings,COALESCE(SUM(CASE WHEN b.status<>'cancelled' THEN b.total ELSE 0 END),0) gross,
    COALESCE(SUM(CASE WHEN b.status<>'cancelled' THEN b.commission_amount ELSE 0 END),0) commission,
    COALESCE(SUM(CASE WHEN b.status<>'cancelled' THEN b.net_amount ELSE 0 END),0) hotel_net,
    COALESCE((SELECT SUM(i.received_payout) FROM hotel_payment_invoices i WHERE i.hotel_id=h.id AND i.updated_at>=NOW()-($1||' days')::interval),0) received,
    COALESCE((SELECT SUM(ABS(i.payout_variance)+ABS(i.collection_variance)) FROM hotel_payment_invoices i WHERE i.hotel_id=h.id AND i.updated_at>=NOW()-($1||' days')::interval),0) variance,
    (SELECT COUNT(*) FROM hotel_payment_alerts a WHERE a.hotel_id=h.id AND a.resolved_at IS NULL)::int alerts
   FROM hotels h LEFT JOIN hotel_bookings b ON b.hotel_id=h.id AND b.created_at>=NOW()-($1||' days')::interval
   GROUP BY h.id,b.currency ORDER BY gross DESC LIMIT 250`,[days])).rows;
  const providers=(await pool.query(`SELECT provider,COUNT(*)::int bookings,COALESCE(SUM(gross_amount),0) gross,COALESCE(SUM(commission_amount),0) commission,COALESCE(SUM(payout_amount),0) expected_payout FROM hotel_ota_financials WHERE updated_at>=NOW()-($1||' days')::interval GROUP BY provider ORDER BY gross DESC`,[days])).rows;
  const alerts=(await pool.query(`SELECT a.*,i.invoice_number,i.provider,i.external_booking_id,h.name hotel_name FROM hotel_payment_alerts a JOIN hotel_payment_invoices i ON i.id=a.invoice_id JOIN hotels h ON h.id=a.hotel_id WHERE a.resolved_at IS NULL ORDER BY CASE a.severity WHEN 'high' THEN 1 ELSE 2 END,a.created_at DESC LIMIT 100`)).rows;
  res.json({days,kpis,hotels,providers,alerts});
 }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل لوحة الفنادق المركزية'});}
});

// ---------------- V29 hotel payouts ----------------
app.post('/api/admin/hotel-payouts/generate',requireAdmin,async(req,res)=>{try{
 const b=req.body||{}, hotelId=Number(b.hotel_id), from=String(b.period_start||''), to=String(b.period_end||''), frequency=['weekly','monthly','manual'].includes(b.frequency)?b.frequency:'manual';
 if(!hotelId||!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return res.status(400).json({error:'بيانات دورة التسوية غير مكتملة'});
 const h=(await pool.query('SELECT id,commission_percent FROM hotels WHERE id=$1',[hotelId])).rows[0];if(!h)return res.status(404).json({error:'الفندق غير موجود'});
 const rows=(await pool.query(`SELECT COALESCE(currency,'USD') currency,COALESCE(SUM(total),0) gross FROM hotel_bookings WHERE hotel_id=$1 AND status NOT IN ('cancelled') AND check_out BETWEEN $2::date AND $3::date GROUP BY COALESCE(currency,'USD')`,[hotelId,from,to])).rows;
 const out=[];for(const x of rows){const gross=Number(x.gross||0),commission=gross*Number(h.commission_percent||0)/100,payout=gross-commission;const q=await pool.query(`INSERT INTO hotel_payout_cycles(hotel_id,period_start,period_end,currency,gross_amount,platform_commission,payout_amount,frequency) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(hotel_id,period_start,period_end,currency) DO UPDATE SET gross_amount=EXCLUDED.gross_amount,platform_commission=EXCLUDED.platform_commission,payout_amount=EXCLUDED.payout_amount,frequency=EXCLUDED.frequency,updated_at=NOW() WHERE hotel_payout_cycles.status='draft' RETURNING *`,[hotelId,from,to,x.currency,gross,commission,payout,frequency]);if(q.rows[0])out.push(q.rows[0]);}
 res.json({data:out});}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/admin/hotel-payouts',requireAdmin,async(req,res)=>{try{const status=String(req.query.status||'');const vals=[];let w='';if(status){vals.push(status);w='WHERE p.status=$1'}const r=await pool.query(`SELECT p.*,h.name hotel_name,h.city FROM hotel_payout_cycles p JOIN hotels h ON h.id=p.hotel_id ${w} ORDER BY p.period_end DESC,p.id DESC LIMIT 500`,vals);res.json({data:r.rows})}catch(e){res.status(500).json({error:e.message})}});
app.patch('/api/admin/hotel-payouts/:id',requireAdmin,async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const p=(await client.query('SELECT * FROM hotel_payout_cycles WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!p){await client.query('ROLLBACK');return res.status(404).json({error:'التسوية غير موجودة'})}const action=String(req.body?.action||'');let status=p.status,extra={};if(action==='approve'&&p.status==='draft'){status='approved';extra.approved_at=new Date().toISOString()}else if(action==='mark_paid'&&['approved','processing'].includes(p.status)){status='paid';extra.paid_at=new Date().toISOString()}else if(action==='reject'&&['draft','approved'].includes(p.status))status='rejected';else return res.status(400).json({error:'لا يمكن تنفيذ الإجراء على الحالة الحالية'});const q=await client.query(`UPDATE hotel_payout_cycles SET status=$1,approved_by=CASE WHEN $1='approved' THEN $2 ELSE approved_by END,approved_at=CASE WHEN $1='approved' THEN NOW() ELSE approved_at END,paid_at=CASE WHEN $1='paid' THEN NOW() ELSE paid_at END,bank_reference=COALESCE($3,bank_reference),payment_method=COALESCE($4,payment_method),notes=COALESCE($5,notes),updated_at=NOW() WHERE id=$6 RETURNING *`,[status,req.user.id,req.body?.bank_reference||null,req.body?.payment_method||null,req.body?.notes||null,p.id]);await client.query(`INSERT INTO hotel_payout_events(payout_id,event_type,actor_user_id,payload) VALUES($1,$2,$3,$4)`,[p.id,action,req.user.id,JSON.stringify(req.body||{})]);await client.query('COMMIT');res.json({data:q.rows[0]})}catch(e){await client.query('ROLLBACK');res.status(500).json({error:e.message})}finally{client.release()}});
app.get('/api/office/hotels/:id/payouts',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).json({error:'الفندق غير موجود'});const r=await pool.query(`SELECT * FROM hotel_payout_cycles WHERE hotel_id=$1 ORDER BY period_end DESC,id DESC`,[req.params.id]);res.json({data:r.rows})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/office/hotels/:id/payouts/:pid/receipt',requireOfficeMember,async(req,res)=>{try{if(!(await ownedHotel(req.params.id,req.office)))return res.status(404).send('Not found');const p=(await pool.query(`SELECT p.*,h.name hotel_name,h.city FROM hotel_payout_cycles p JOIN hotels h ON h.id=p.hotel_id WHERE p.id=$1 AND p.hotel_id=$2`,[req.params.pid,req.params.id])).rows[0];if(!p)return res.status(404).send('Not found');res.type('html').send(`<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><title>إيصال تسوية #${p.id}</title><style>body{font-family:Arial;max-width:760px;margin:40px auto;line-height:2}.box{border:1px solid #ddd;padding:24px}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #eee;padding:8px}</style><div class="box"><h1>عقارتكم — إيصال تسوية فندق</h1><h2>${p.hotel_name}</h2><table><tr><td>رقم التسوية</td><td>#${p.id}</td></tr><tr><td>الفترة</td><td>${p.period_start} — ${p.period_end}</td></tr><tr><td>إجمالي الحجوزات</td><td>${p.gross_amount} ${p.currency}</td></tr><tr><td>عمولة المنصة</td><td>${p.platform_commission} ${p.currency}</td></tr><tr><td>التعديلات</td><td>${p.adjustments} ${p.currency}</td></tr><tr><td><b>صافي التحويل</b></td><td><b>${p.payout_amount} ${p.currency}</b></td></tr><tr><td>الحالة</td><td>${p.status}</td></tr><tr><td>مرجع التحويل</td><td>${p.bank_reference||'—'}</td></tr></table><p>تاريخ الإصدار: ${new Date().toLocaleString('ar-SA')}</p></div><script>window.print()</script></html>`)}catch(e){res.status(500).send('Error')}});

// ---------------- V30 automated payouts / batch accounting ----------------
async function generatePayoutCycle(hotelId,from,to,frequency='manual'){
 const h=(await pool.query('SELECT id,platform_commission_rate AS commission_percent FROM hotels WHERE id=$1',[hotelId])).rows[0]; if(!h)return [];
 const rows=(await pool.query(`SELECT COALESCE(currency,'USD') currency,COALESCE(SUM(total),0) gross FROM hotel_bookings WHERE hotel_id=$1 AND status<>'cancelled' AND check_out BETWEEN $2::date AND $3::date GROUP BY COALESCE(currency,'USD')`,[hotelId,from,to])).rows,out=[];
 for(const x of rows){const gross=Number(x.gross),commission=gross*Number(h.commission_percent)/100,payout=gross-commission;const q=await pool.query(`INSERT INTO hotel_payout_cycles(hotel_id,period_start,period_end,currency,gross_amount,platform_commission,payout_amount,frequency) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(hotel_id,period_start,period_end,currency) DO UPDATE SET gross_amount=EXCLUDED.gross_amount,platform_commission=EXCLUDED.platform_commission,payout_amount=EXCLUDED.payout_amount,updated_at=NOW() WHERE hotel_payout_cycles.status='draft' RETURNING *`,[hotelId,from,to,x.currency,gross,commission,payout,frequency]);if(q.rows[0])out.push(q.rows[0]);} return out;
}
async function payoutWarnings(p){const r=(await pool.query(`SELECT COALESCE(SUM(ABS(payout_variance)+ABS(collection_variance)),0) variance,COUNT(*) FILTER(WHERE status NOT IN ('matched','paid'))::int unmatched FROM hotel_payment_invoices WHERE hotel_id=$1 AND updated_at::date BETWEEN $2 AND $3`,[p.hotel_id,p.period_start,p.period_end])).rows[0];const s=(await pool.query('SELECT COALESCE(variance_tolerance,.01) tolerance,COALESCE(require_clean_reconciliation,true) clean FROM hotel_payout_settings WHERE hotel_id=$1',[p.hotel_id])).rows[0]||{tolerance:.01,clean:true};return {variance:Number(r.variance),unmatched:Number(r.unmatched),blocked:Boolean(s.clean)&&(Number(r.variance)>Number(s.tolerance)||Number(r.unmatched)>0),tolerance:Number(s.tolerance)};}
async function runAutomaticPayouts(){const today=new Date(),dow=today.getUTCDay(),day=today.getUTCDate();const settings=(await pool.query(`SELECT s.*,h.name FROM hotel_payout_settings s JOIN hotels h ON h.id=s.hotel_id WHERE s.auto_generate=TRUE AND ((s.frequency='weekly' AND s.weekday=$1) OR (s.frequency='monthly' AND s.month_day=$2))`,[dow,Math.min(day,28)])).rows;for(const s of settings){const end=new Date(today);end.setUTCDate(end.getUTCDate()-Number(s.hold_days||0)-1);let start;if(s.last_generated_through){start=new Date(s.last_generated_through);start.setUTCDate(start.getUTCDate()+1)}else{start=new Date(end);start.setUTCDate(start.getUTCDate()-(s.frequency==='weekly'?6:29))}if(start>end)continue;await generatePayoutCycle(s.hotel_id,start.toISOString().slice(0,10),end.toISOString().slice(0,10),s.frequency);await pool.query('UPDATE hotel_payout_settings SET last_generated_through=$1,updated_at=NOW() WHERE hotel_id=$2',[end.toISOString().slice(0,10),s.hotel_id]);}}
setInterval(()=>runAutomaticPayouts().catch(e=>console.error('V30 payout scheduler',e)),60*60*1000);setTimeout(()=>runAutomaticPayouts().catch(()=>{}),15000);
app.get('/api/admin/hotel-payout-automation',requireAdmin,async(req,res)=>{try{const settings=(await pool.query(`SELECT h.id hotel_id,h.name,h.city,COALESCE(s.frequency,'monthly') frequency,COALESCE(s.auto_generate,true) auto_generate,COALESCE(s.require_clean_reconciliation,true) require_clean_reconciliation,COALESCE(s.variance_tolerance,.01) variance_tolerance,s.last_generated_through FROM hotels h LEFT JOIN hotel_payout_settings s ON s.hotel_id=h.id ORDER BY h.name`)).rows;const batches=(await pool.query(`SELECT b.*,COALESCE(json_agg(json_build_object('payout_id',p.id,'hotel',h.name,'amount',i.amount)) FILTER(WHERE p.id IS NOT NULL),'[]') items FROM hotel_payout_batches b LEFT JOIN hotel_payout_batch_items i ON i.batch_id=b.id LEFT JOIN hotel_payout_cycles p ON p.id=i.payout_id LEFT JOIN hotels h ON h.id=p.hotel_id GROUP BY b.id ORDER BY b.id DESC LIMIT 100`)).rows;res.json({settings,batches})}catch(e){res.status(500).json({error:e.message})}});
app.put('/api/admin/hotel-payout-automation/:hotelId',requireAdmin,async(req,res)=>{try{const b=req.body||{};const q=await pool.query(`INSERT INTO hotel_payout_settings(hotel_id,frequency,weekday,month_day,auto_generate,require_clean_reconciliation,variance_tolerance,hold_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(hotel_id) DO UPDATE SET frequency=EXCLUDED.frequency,weekday=EXCLUDED.weekday,month_day=EXCLUDED.month_day,auto_generate=EXCLUDED.auto_generate,require_clean_reconciliation=EXCLUDED.require_clean_reconciliation,variance_tolerance=EXCLUDED.variance_tolerance,hold_days=EXCLUDED.hold_days,updated_at=NOW() RETURNING *`,[req.params.hotelId,b.frequency==='weekly'?'weekly':'monthly',Number(b.weekday??1),Number(b.month_day??1),b.auto_generate!==false,b.require_clean_reconciliation!==false,Number(b.variance_tolerance??.01),Number(b.hold_days??0)]);res.json({data:q.rows[0]})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/admin/hotel-payout-automation/run',requireAdmin,async(req,res)=>{try{await runAutomaticPayouts();res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/admin/hotel-payouts/:id/check',requireAdmin,async(req,res)=>{try{const p=(await pool.query('SELECT * FROM hotel_payout_cycles WHERE id=$1',[req.params.id])).rows[0];if(!p)return res.status(404).json({error:'غير موجود'});res.json(await payoutWarnings(p))}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/admin/hotel-payout-batches',requireAdmin,async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const ids=[...new Set((req.body?.payout_ids||[]).map(Number).filter(Boolean))];if(!ids.length)throw new Error('اختر تسوية واحدة على الأقل');const rows=(await client.query(`SELECT * FROM hotel_payout_cycles WHERE id=ANY($1::bigint[]) AND status='approved' FOR UPDATE`,[ids])).rows;if(rows.length!==ids.length)throw new Error('بعض التسويات غير معتمدة أو أضيفت لدفعة سابقاً');const currencies=[...new Set(rows.map(x=>x.currency))];if(currencies.length!==1)throw new Error('يجب أن تحتوي الدفعة على عملة واحدة');for(const p of rows){const w=await payoutWarnings(p);if(w.blocked)throw new Error(`التسوية #${p.id} موقوفة بسبب فروقات مالية`)}const code='AQPB-'+Date.now();const total=rows.reduce((a,x)=>a+Number(x.payout_amount),0);const batch=(await client.query(`INSERT INTO hotel_payout_batches(batch_code,currency,total_amount,payout_count) VALUES($1,$2,$3,$4) RETURNING *`,[code,currencies[0],total,rows.length])).rows[0];for(const p of rows)await client.query('INSERT INTO hotel_payout_batch_items(batch_id,payout_id,amount) VALUES($1,$2,$3)',[batch.id,p.id,p.payout_amount]);await client.query('COMMIT');res.json({data:batch})}catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}});
app.patch('/api/admin/hotel-payout-batches/:id',requireAdmin,async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const b=(await client.query('SELECT * FROM hotel_payout_batches WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!b)throw new Error('الدفعة غير موجودة');const action=String(req.body?.action||'');let status=b.status;if(action==='approve'&&status==='draft')status='approved';else if(action==='mark_paid'&&['approved','processing'].includes(status))status='paid';else throw new Error('الإجراء غير متاح');const q=(await client.query(`UPDATE hotel_payout_batches SET status=$1,approved_by=CASE WHEN $1='approved' THEN $2 ELSE approved_by END,approved_at=CASE WHEN $1='approved' THEN NOW() ELSE approved_at END,paid_at=CASE WHEN $1='paid' THEN NOW() ELSE paid_at END,bank_reference=COALESCE($3,bank_reference),updated_at=NOW() WHERE id=$4 RETURNING *`,[status,req.user.id,req.body?.bank_reference||null,b.id])).rows[0];if(status==='paid'){const items=(await client.query(`SELECT i.*,p.hotel_id,p.currency FROM hotel_payout_batch_items i JOIN hotel_payout_cycles p ON p.id=i.payout_id WHERE i.batch_id=$1`,[b.id])).rows;for(const i of items){await client.query(`UPDATE hotel_payout_cycles SET status='paid',paid_at=NOW(),bank_reference=COALESCE($1,bank_reference),updated_at=NOW() WHERE id=$2`,[req.body?.bank_reference||b.bank_reference,i.payout_id]);await client.query(`INSERT INTO hotel_accounting_ledger(hotel_id,payout_id,batch_id,entry_type,direction,amount,currency,reference) VALUES($1,$2,$3,'hotel_payout','debit',$4,$5,$6)`,[i.hotel_id,i.payout_id,b.id,i.amount,i.currency,req.body?.bank_reference||b.bank_reference]);}}await client.query('COMMIT');res.json({data:q})}catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}});
app.get('/api/admin/hotel-accounting-ledger',requireAdmin,async(req,res)=>{try{const r=await pool.query(`SELECT l.*,h.name hotel_name,b.batch_code FROM hotel_accounting_ledger l LEFT JOIN hotels h ON h.id=l.hotel_id LEFT JOIN hotel_payout_batches b ON b.id=l.batch_id ORDER BY l.id DESC LIMIT 500`);res.json({data:r.rows})}catch(e){res.status(500).json({error:e.message})}});


// ---------------- V31 integrated platform accounting ----------------
function accountingDates(req){
 const now=new Date(), year=Number(req.query.year||now.getUTCFullYear()), month=Number(req.query.month||0);
 if(month>=1&&month<=12){const from=`${year}-${String(month).padStart(2,'0')}-01`;const end=new Date(Date.UTC(year,month,0));return {from,to:end.toISOString().slice(0,10),year,month};}
 return {from:`${year}-01-01`,to:`${year}-12-31`,year,month:0};
}
app.get('/api/admin/accounting/dashboard',requireAdmin,async(req,res)=>{try{
 const d=accountingDates(req), vals=[d.from,d.to];
 const hotel=(await pool.query(`SELECT COALESCE(SUM(commission_amount),0) revenue,COALESCE(SUM(total),0) gross FROM hotel_bookings WHERE status<>'cancelled' AND created_at::date BETWEEN $1 AND $2`,vals)).rows[0];
 const realestate=(await pool.query(`SELECT COALESCE(SUM(platform_commission),0) revenue,COALESCE(SUM(amount),0) gross FROM office_deals WHERE status='completed' AND COALESCE(closed_at,created_at)::date BETWEEN $1 AND $2`,vals)).rows[0];
 const ads=(await pool.query(`SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END),0) revenue FROM ad_wallet_ledger WHERE created_at::date BETWEEN $1 AND $2`,vals).catch(()=>({rows:[{revenue:0}]}))).rows[0];
 const exp=(await pool.query(`SELECT COALESCE(SUM(amount),0) total,COALESCE(SUM(tax_amount),0) tax FROM platform_expenses WHERE expense_date BETWEEN $1 AND $2 AND status<>'void'`,vals)).rows[0];
 const ar=(await pool.query(`SELECT COALESCE(SUM(expected_payout-received_payout),0)+COALESCE(SUM(guest_collect_expected-guest_collected),0) amount FROM hotel_payment_invoices WHERE status NOT IN ('matched','paid')`)).rows[0];
 const ap=(await pool.query(`SELECT COALESCE(SUM(payout_amount),0) amount FROM hotel_payout_cycles WHERE status IN ('approved','processing')`)).rows[0];
 const tax=(await pool.query(`SELECT COALESCE(SUM(tax_amount),0) input_tax FROM platform_expenses WHERE expense_date BETWEEN $1 AND $2 AND status<>'void'`,vals)).rows[0];
 const revenue=Number(hotel.revenue)+Number(realestate.revenue)+Number(ads.revenue||0), expenses=Number(exp.total), profit=revenue-expenses;
 const monthly=(await pool.query(`WITH m AS (SELECT generate_series(date_trunc('month',$1::date),date_trunc('month',$2::date),'1 month') d) SELECT to_char(m.d,'YYYY-MM') AS "month", COALESCE((SELECT SUM(commission_amount) FROM hotel_bookings b WHERE b.status<>'cancelled' AND date_trunc('month',b.created_at)=m.d),0)+COALESCE((SELECT SUM(platform_commission) FROM office_deals o WHERE o.status='completed' AND date_trunc('month',COALESCE(o.closed_at,o.created_at))=m.d),0) revenue, COALESCE((SELECT SUM(amount) FROM platform_expenses e WHERE e.status<>'void' AND date_trunc('month',e.expense_date)=m.d),0) expenses FROM m ORDER BY m.d`,vals)).rows;
 res.json({period:d,kpis:{revenue,expenses,profit,hotel_commission:Number(hotel.revenue),realestate_commission:Number(realestate.revenue),ad_revenue:Number(ads.revenue||0),accounts_receivable:Number(ar.amount),accounts_payable:Number(ap.amount),input_tax:Number(tax.input_tax||0)},monthly});
 }catch(e){res.status(500).json({error:e.message})}});
app.get('/api/admin/accounting/expenses',requireAdmin,async(req,res)=>{try{const d=accountingDates(req);const r=await pool.query(`SELECT * FROM platform_expenses WHERE expense_date BETWEEN $1 AND $2 ORDER BY expense_date DESC,id DESC`,[d.from,d.to]);res.json({data:r.rows,period:d})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/admin/accounting/expenses',requireAdmin,async(req,res)=>{try{const b=req.body||{},amount=Number(b.amount),tax=Number(b.tax_amount||0);if(!(amount>0))return res.status(400).json({error:'أدخل مبلغ المصروف'});const q=await pool.query(`INSERT INTO platform_expenses(expense_date,category,vendor,description,amount,tax_amount,currency,payment_method,reference,created_by) VALUES(COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[b.expense_date||null,b.category||'تشغيل',b.vendor||null,b.description||null,amount,tax,b.currency||'USD',b.payment_method||null,b.reference||null,req.user.id]);res.json({data:q.rows[0]})}catch(e){res.status(500).json({error:e.message})}});
app.patch('/api/admin/accounting/expenses/:id',requireAdmin,async(req,res)=>{try{const b=req.body||{};const q=await pool.query(`UPDATE platform_expenses SET status=COALESCE($1,status),description=COALESCE($2,description),updated_at=NOW() WHERE id=$3 RETURNING *`,[b.status||null,b.description||null,req.params.id]);res.json({data:q.rows[0]||null})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/admin/accounting/receivables-payables',requireAdmin,async(req,res)=>{try{const receivables=(await pool.query(`SELECT i.id,i.invoice_number,i.provider,i.external_booking_id,i.currency,(i.expected_payout-i.received_payout)+(i.guest_collect_expected-i.guest_collected) balance,h.name hotel_name,i.updated_at FROM hotel_payment_invoices i JOIN hotels h ON h.id=i.hotel_id WHERE ABS((i.expected_payout-i.received_payout)+(i.guest_collect_expected-i.guest_collected))>.009 ORDER BY ABS((i.expected_payout-i.received_payout)+(i.guest_collect_expected-i.guest_collected)) DESC LIMIT 300`)).rows;const payables=(await pool.query(`SELECT p.id,h.name hotel_name,p.period_start,p.period_end,p.currency,p.payout_amount balance,p.status FROM hotel_payout_cycles p JOIN hotels h ON h.id=p.hotel_id WHERE p.status IN ('approved','processing') ORDER BY p.period_end`)).rows;res.json({receivables,payables})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/admin/accounting/report.csv',requireAdmin,async(req,res)=>{try{const d=accountingDates(req);const dashReq={query:{year:d.year,month:d.month}};const hotel=(await pool.query(`SELECT COALESCE(SUM(commission_amount),0) v FROM hotel_bookings WHERE status<>'cancelled' AND created_at::date BETWEEN $1 AND $2`,[d.from,d.to])).rows[0].v;const real=(await pool.query(`SELECT COALESCE(SUM(platform_commission),0) v FROM office_deals WHERE status='completed' AND COALESCE(closed_at,created_at)::date BETWEEN $1 AND $2`,[d.from,d.to])).rows[0].v;const exp=(await pool.query(`SELECT COALESCE(SUM(amount),0) v FROM platform_expenses WHERE status<>'void' AND expense_date BETWEEN $1 AND $2`,[d.from,d.to])).rows[0].v;const rows=[['البند','المبلغ'],['عمولات الفنادق',hotel],['عمولات العقارات',real],['المصروفات',exp],['صافي الربح',Number(hotel)+Number(real)-Number(exp)]];res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename=aqartkom-accounting-${d.year}-${d.month||'year'}.csv`);res.send('\ufeff'+rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\n'));}catch(e){res.status(500).json({error:e.message})}});


// ---------------- V32 electronic invoicing ----------------

// V33 automatic invoicing -------------------------------------------------
async function autoInvoice(c,{sourceType,sourceId,sourceReference,customerType='customer',customerId=null,customerName,customerTaxNumber=null,customerEmail=null,currency='SAR',description,amount,taxRate=0,paidAmount=0,notes=null}){
  amount=Number(amount||0); taxRate=Number(taxRate||0); if(!(amount>0)||!sourceType||!sourceId||!customerName)return null;
  const existing=(await c.query(`SELECT * FROM electronic_invoices WHERE source_type=$1 AND source_id=$2 AND document_type='invoice' LIMIT 1`,[sourceType,String(sourceId)])).rows[0];
  if(existing)return {invoice:existing,created:false};
  const tax=amount*taxRate/100,total=amount+tax,num=einvNumber('invoice');
  const qr=JSON.stringify({seller:process.env.PLATFORM_LEGAL_NAME||'Aqartkom',tax_number:process.env.PLATFORM_TAX_NUMBER||'',invoice:num,date:new Date().toISOString(),total:total.toFixed(2),tax:tax.toFixed(2),currency});
  const paid=Math.min(Number(paidAmount||0),total),status=paid+0.005>=total?'paid':paid>0?'partially_paid':'issued';
  const inv=(await c.query(`INSERT INTO electronic_invoices(invoice_number,document_type,source_type,source_id,source_reference,customer_type,customer_id,customer_name,customer_tax_number,customer_email,currency,subtotal,tax_amount,total_amount,paid_amount,status,issue_date,notes,qr_payload,auto_generated) VALUES($1,'invoice',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_DATE,$16,$17,TRUE) ON CONFLICT DO NOTHING RETURNING *`,[num,sourceType,String(sourceId),sourceReference||null,customerType,customerId,customerName,customerTaxNumber,customerEmail,currency,amount,tax,total,paid,status,notes,qr])).rows[0];
  if(!inv){const e=(await c.query(`SELECT * FROM electronic_invoices WHERE source_type=$1 AND source_id=$2 AND document_type='invoice' LIMIT 1`,[sourceType,String(sourceId)])).rows[0];return {invoice:e,created:false};}
  await c.query(`INSERT INTO electronic_invoice_items(invoice_id,description,quantity,unit_price,tax_rate,line_subtotal,line_tax,line_total) VALUES($1,$2,1,$3,$4,$3,$5,$6)`,[inv.id,description,amount,taxRate,tax,total]);
  if(paid>0)await c.query(`INSERT INTO electronic_invoice_payments(invoice_id,amount,payment_method,reference) VALUES($1,$2,'automatic',$3)`,[inv.id,paid,sourceReference||sourceType+'-'+sourceId]);
  return {invoice:inv,created:true};
}
async function generateAutomaticInvoices({createdBy=null,triggerType='manual'}={}){
 const c=await pool.connect();let scanned=0,created=0,skipped=0,errors=[];
 try{await c.query('BEGIN');
  const taxRate=Number(process.env.PLATFORM_DEFAULT_TAX_RATE||0);
  const hotels=(await c.query(`SELECT b.id,b.booking_code,b.currency,b.commission_amount,b.status,h.id hotel_id,h.name hotel_name,(SELECT u.email FROM users u WHERE u.id=h.owner_id) hotel_email FROM hotel_bookings b JOIN hotels h ON h.id=b.hotel_id WHERE b.status<>'cancelled' AND COALESCE(b.commission_amount,0)>0`)).rows;
  for(const x of hotels){scanned++;try{const r=await autoInvoice(c,{sourceType:'hotel_booking_commission',sourceId:x.id,sourceReference:x.booking_code,customerType:'hotel',customerId:x.hotel_id,customerName:x.hotel_name,customerEmail:x.hotel_email,currency:x.currency,description:`عمولة منصة عقارتكم على حجز الفندق ${x.booking_code}`,amount:x.commission_amount,taxRate});r?.created?created++:skipped++;}catch(e){errors.push(e.message)}}
  const deals=(await c.query(`SELECT d.id,d.mode,d.platform_commission,d.status,o.id office_id,o.name office_name,u.email FROM office_deals d JOIN offices o ON o.id=d.office_id LEFT JOIN users u ON u.id=o.owner_id WHERE d.status='completed' AND COALESCE(d.platform_commission,0)>0`)).rows;
  for(const x of deals){scanned++;try{const r=await autoInvoice(c,{sourceType:'real_estate_deal_commission',sourceId:x.id,sourceReference:`DEAL-${x.id}`,customerType:'office',customerId:x.office_id,customerName:x.office_name,customerEmail:x.email,currency:process.env.PLATFORM_CURRENCY||'SAR',description:`عمولة عقارتكم على صفقة ${x.mode}`,amount:x.platform_commission,taxRate});r?.created?created++:skipped++;}catch(e){errors.push(e.message)}}
  const pays=(await c.query(`SELECT p.*,o.name office_name,u.email FROM payments p LEFT JOIN offices o ON o.id=p.office_id LEFT JOIN users u ON u.id=COALESCE(p.user_id,o.owner_id) WHERE p.status='paid'`)).rows;
  for(const x of pays){const kind=x.metadata?.kind||'payment';if(!['subscription','wallet_topup'].includes(kind))continue;scanned++;try{const r=await autoInvoice(c,{sourceType:kind==='subscription'?'office_subscription':'wallet_topup',sourceId:x.id,sourceReference:x.invoice_no||x.provider_payment_id||`PAY-${x.id}`,customerType:'office',customerId:x.office_id,customerName:x.office_name||'عميل عقارتكم',customerEmail:x.email,currency:x.currency,description:kind==='subscription'?'اشتراك مكتب عقاري في منصة عقارتكم':'شحن رصيد الإعلانات في عقارتكم',amount:x.amount,taxRate:0,paidAmount:x.amount});r?.created?created++:skipped++;}catch(e){errors.push(e.message)}}
  const ads=(await c.query(`SELECT a.*,o.name office_name,u.email FROM ad_invoices a JOIN offices o ON o.id=a.office_id LEFT JOIN users u ON u.id=o.owner_id WHERE a.amount>0`)).rows;
  for(const x of ads){scanned++;try{const r=await autoInvoice(c,{sourceType:'paid_ad_usage',sourceId:x.id,sourceReference:x.invoice_no,customerType:'office',customerId:x.office_id,customerName:x.office_name,customerEmail:x.email,currency:x.currency,description:x.description||'استهلاك إعلان مدفوع في عقارتكم',amount:x.amount,taxRate,paidAmount:x.amount});r?.created?created++:skipped++;}catch(e){errors.push(e.message)}}
  const payouts=(await c.query(`SELECT p.*,h.name hotel_name,(SELECT u.email FROM users u WHERE u.id=h.owner_id) hotel_email FROM hotel_payout_cycles p JOIN hotels h ON h.id=p.hotel_id WHERE p.status='paid' AND COALESCE(p.platform_commission,0)>0`)).rows;
  for(const x of payouts){scanned++;try{const r=await autoInvoice(c,{sourceType:'hotel_payout_commission',sourceId:x.id,sourceReference:x.bank_reference||`PAYOUT-${x.id}`,customerType:'hotel',customerId:x.hotel_id,customerName:x.hotel_name,customerEmail:x.hotel_email,currency:x.currency,description:`عمولة عقارتكم ضمن تسوية الفندق ${x.period_start} — ${x.period_end}`,amount:x.platform_commission,taxRate});r?.created?created++:skipped++;}catch(e){errors.push(e.message)}}
  await c.query(`INSERT INTO automatic_invoice_runs(trigger_type,scanned_count,created_count,skipped_count,error_count,details,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,[triggerType,scanned,created,skipped,errors.length,JSON.stringify({errors:errors.slice(0,50)}),createdBy]);
  await c.query('COMMIT');return {scanned,created,skipped,error_count:errors.length,errors};
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
app.post('/api/admin/einvoices/auto-generate',requireAdmin,async(req,res)=>{try{res.json({data:await generateAutomaticInvoices({createdBy:req.user.id,triggerType:'admin'})})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/admin/einvoices/auto-runs',requireAdmin,async(req,res)=>{try{res.json({data:(await pool.query(`SELECT * FROM automatic_invoice_runs ORDER BY id DESC LIMIT 100`)).rows})}catch(e){res.status(500).json({error:e.message})}});
setInterval(()=>generateAutomaticInvoices({triggerType:'scheduler'}).catch(e=>console.error('V33 auto invoice:',e.message)),Number(process.env.AUTO_INVOICE_INTERVAL_MS||300000)).unref();
setTimeout(()=>generateAutomaticInvoices({triggerType:'startup'}).catch(e=>console.error('V33 startup invoice:',e.message)),15000).unref();
// -------------------------------------------------------------------------

function einvNumber(type='invoice'){const p=type==='credit_note'?'CN':type==='debit_note'?'DN':'INV';return `AQ-${p}-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${Date.now().toString().slice(-8)}`}
async function einvFull(id){const inv=(await pool.query('SELECT * FROM electronic_invoices WHERE id=$1',[id])).rows[0];if(!inv)return null;inv.items=(await pool.query('SELECT * FROM electronic_invoice_items WHERE invoice_id=$1 ORDER BY id',[id])).rows;inv.payments=(await pool.query('SELECT * FROM electronic_invoice_payments WHERE invoice_id=$1 ORDER BY paid_at DESC',[id])).rows;return inv}
app.get('/api/admin/einvoices',requireAdmin,async(req,res)=>{try{const status=String(req.query.status||''),vals=[];let w='';if(status){vals.push(status);w='WHERE status=$1'}const r=await pool.query(`SELECT *,total_amount-paid_amount balance FROM electronic_invoices ${w} ORDER BY issue_date DESC,id DESC LIMIT 500`,vals);res.json({data:r.rows})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/admin/einvoices',requireAdmin,async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const b=req.body||{},items=Array.isArray(b.items)?b.items:[];if(!b.customer_name||!items.length)throw new Error('اسم العميل وبند واحد على الأقل مطلوبان');let sub=0,tax=0;const calc=items.map(i=>{const q=Number(i.quantity||1),u=Number(i.unit_price||0),r=Number(i.tax_rate||0),ls=q*u,lt=ls*r/100;sub+=ls;tax+=lt;return {...i,q,u,r,ls,lt}});const total=sub+tax,num=einvNumber(b.document_type);const qr=JSON.stringify({seller:process.env.PLATFORM_LEGAL_NAME||'Aqartkom',tax_number:process.env.PLATFORM_TAX_NUMBER||'',invoice:num,date:new Date().toISOString(),total:total.toFixed(2),tax:tax.toFixed(2),currency:b.currency||'SAR'});const q=await c.query(`INSERT INTO electronic_invoices(invoice_number,document_type,source_type,source_id,customer_type,customer_id,customer_name,customer_tax_number,customer_email,currency,subtotal,tax_amount,total_amount,issue_date,due_date,parent_invoice_id,notes,qr_payload,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::date,CURRENT_DATE),$15,$16,$17,$18,$19) RETURNING *`,[num,b.document_type||'invoice',b.source_type||'manual',b.source_id||null,b.customer_type||'customer',b.customer_id||null,b.customer_name,b.customer_tax_number||null,b.customer_email||null,b.currency||'SAR',sub,tax,total,b.issue_date||null,b.due_date||null,b.parent_invoice_id||null,b.notes||null,qr,req.user.id]);for(const i of calc)await c.query(`INSERT INTO electronic_invoice_items(invoice_id,description,quantity,unit_price,tax_rate,line_subtotal,line_tax,line_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[q.rows[0].id,i.description,i.q,i.u,i.r,i.ls,i.lt,i.ls+i.lt]);await c.query('COMMIT');res.json({data:await einvFull(q.rows[0].id)})}catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message})}finally{c.release()}});
app.post('/api/admin/einvoices/:id/payments',requireAdmin,async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const inv=(await c.query('SELECT * FROM electronic_invoices WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!inv)throw new Error('الفاتورة غير موجودة');const amount=Number(req.body?.amount||0);if(!(amount>0)||Number(inv.paid_amount)+amount>Number(inv.total_amount)+0.01)throw new Error('مبلغ السداد غير صالح');await c.query(`INSERT INTO electronic_invoice_payments(invoice_id,amount,payment_method,reference,created_by) VALUES($1,$2,$3,$4,$5)`,[inv.id,amount,req.body?.payment_method||'bank_transfer',req.body?.reference||null,req.user.id]);const paid=Number(inv.paid_amount)+amount,status=paid+0.005>=Number(inv.total_amount)?'paid':'partially_paid';await c.query('UPDATE electronic_invoices SET paid_amount=$1,status=$2,updated_at=NOW() WHERE id=$3',[paid,status,inv.id]);await c.query('COMMIT');res.json({data:await einvFull(inv.id)})}catch(e){await c.query('ROLLBACK');res.status(400).json({error:e.message})}finally{c.release()}});
app.post('/api/admin/einvoices/:id/adjustment',requireAdmin,async(req,res)=>{try{const parent=await einvFull(req.params.id);if(!parent)return res.status(404).json({error:'الفاتورة غير موجودة'});const type=req.body?.document_type==='debit_note'?'debit_note':'credit_note';req.body={...req.body,document_type:type,parent_invoice_id:parent.id,customer_name:parent.customer_name,customer_tax_number:parent.customer_tax_number,customer_email:parent.customer_email,currency:parent.currency};return res.status(400).json({error:'استخدم إنشاء فاتورة جديدة مع parent_invoice_id ونوع credit_note/debit_note'})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/admin/einvoices/:id/qr',requireAdmin,async(req,res)=>{try{const QRCode=require('qrcode'),inv=await einvFull(req.params.id);if(!inv)return res.status(404).send('Not found');const png=await QRCode.toBuffer(inv.qr_payload||inv.invoice_number,{type:'png',width:320,margin:1});res.type('png').send(png)}catch(e){res.status(500).send('QR error')}});
app.get('/api/admin/einvoices/:id/pdf',requireAdmin,async(req,res)=>{try{const PDFDocument=require('pdfkit'),QRCode=require('qrcode'),inv=await einvFull(req.params.id);if(!inv)return res.status(404).send('Not found');const doc=new PDFDocument({size:'A4',margin:45});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename=${inv.invoice_number}.pdf`);doc.pipe(res);const font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';try{doc.font(font)}catch{}doc.fontSize(20).text('AQARTKOM — ELECTRONIC INVOICE',{align:'center'});doc.moveDown().fontSize(11).text(`Invoice: ${inv.invoice_number}`).text(`Type: ${inv.document_type}`).text(`Issue date: ${String(inv.issue_date).slice(0,10)}`).text(`Customer: ${inv.customer_name}`).text(`Tax number: ${inv.customer_tax_number||'-'}`).text(`Status: ${inv.status}`);doc.moveDown();for(const i of inv.items)doc.text(`${i.description}   ${i.quantity} x ${i.unit_price}   Tax ${i.tax_rate}%   = ${i.line_total} ${inv.currency}`);doc.moveDown().fontSize(12).text(`Subtotal: ${inv.subtotal} ${inv.currency}`,{align:'right'}).text(`Tax: ${inv.tax_amount} ${inv.currency}`,{align:'right'}).fontSize(14).text(`TOTAL: ${inv.total_amount} ${inv.currency}`,{align:'right'}).fontSize(11).text(`Paid: ${inv.paid_amount} ${inv.currency}`,{align:'right'});const qr=await QRCode.toDataURL(inv.qr_payload||inv.invoice_number,{width:220,margin:1}),buf=Buffer.from(qr.split(',')[1],'base64');doc.image(buf,45,doc.y+20,{width:110});doc.fontSize(8).text('QR verification payload',165,doc.y+55);doc.end()}catch(e){if(!res.headersSent)res.status(500).send('PDF error')}});


// V34 executive business intelligence dashboard -------------------------
function biPeriod(req){const days=Math.min(365,Math.max(7,Number(req.query.days||30)));return {days};}
app.get('/api/admin/executive-bi',requireAdmin,async(req,res)=>{try{
 const {days}=biPeriod(req); const prevDays=days*2;
 const one=async(q,a=[])=>Number((await pool.query(q,a)).rows[0]?.v||0);
 const currentRevenue=await one(`SELECT COALESCE(SUM(total_amount),0) v FROM electronic_invoices WHERE document_type='invoice' AND status<>'void' AND issue_date>=CURRENT_DATE-$1::int`,[days]);
 const previousRevenue=await one(`SELECT COALESCE(SUM(total_amount),0) v FROM electronic_invoices WHERE document_type='invoice' AND status<>'void' AND issue_date<CURRENT_DATE-$1::int AND issue_date>=CURRENT_DATE-$2::int`,[days,prevDays]);
 const expenses=await one(`SELECT COALESCE(SUM(amount+tax_amount),0) v FROM platform_expenses WHERE status='posted' AND expense_date>=CURRENT_DATE-$1::int`,[days]);
 const bookings=await one(`SELECT COUNT(*) v FROM hotel_bookings WHERE status<>'cancelled' AND created_at>=NOW()-($1::text||' days')::interval`,[days]);
 const bookingValue=await one(`SELECT COALESCE(SUM(total),0) v FROM hotel_bookings WHERE status<>'cancelled' AND created_at>=NOW()-($1::text||' days')::interval`,[days]);
 const completedDeals=await one(`SELECT COUNT(*) v FROM office_deals WHERE status='completed' AND COALESCE(closed_at,created_at)>=NOW()-($1::text||' days')::interval`,[days]);
 const dealValue=await one(`SELECT COALESCE(SUM(amount),0) v FROM office_deals WHERE status='completed' AND COALESCE(closed_at,created_at)>=NOW()-($1::text||' days')::interval`,[days]);
 const [properties,hotels,offices,users]=await Promise.all([
  one(`SELECT COUNT(*) v FROM properties WHERE status='active'`),one(`SELECT COUNT(*) v FROM hotels WHERE status='active'`),one(`SELECT COUNT(*) v FROM offices`),one(`SELECT COUNT(*) v FROM users WHERE is_active=TRUE`)
 ]);
 const monthly=(await pool.query(`WITH m AS (SELECT generate_series(date_trunc('month',CURRENT_DATE)-interval '11 months',date_trunc('month',CURRENT_DATE),interval '1 month') AS "month") SELECT to_char(m.month,'YYYY-MM') AS "month",COALESCE((SELECT SUM(total_amount) FROM electronic_invoices i WHERE i.document_type='invoice' AND i.status<>'void' AND date_trunc('month',i.issue_date)=m.month),0) revenue,COALESCE((SELECT SUM(amount+tax_amount) FROM platform_expenses e WHERE e.status='posted' AND date_trunc('month',e.expense_date)=m.month),0) expenses FROM m ORDER BY m.month`)).rows;
 const cities=(await pool.query(`SELECT city,SUM(property_count) property_count,SUM(hotel_count) hotel_count,SUM(booking_count) booking_count FROM (SELECT city,COUNT(*) property_count,0::bigint hotel_count,0::bigint booking_count FROM properties WHERE status='active' GROUP BY city UNION ALL SELECT city,0,COUNT(*),0 FROM hotels WHERE status='active' GROUP BY city UNION ALL SELECT h.city,0,0,COUNT(*) FROM hotel_bookings b JOIN hotels h ON h.id=b.hotel_id WHERE b.status<>'cancelled' AND b.created_at>=NOW()-($1::text||' days')::interval GROUP BY h.city) x GROUP BY city ORDER BY (SUM(property_count)+SUM(hotel_count)+SUM(booking_count)) DESC LIMIT 10`,[days])).rows;
 const topHotels=(await pool.query(`SELECT h.id,h.name,h.city,COUNT(b.id) bookings,COALESCE(SUM(b.total),0) booking_value FROM hotels h LEFT JOIN hotel_bookings b ON b.hotel_id=h.id AND b.status<>'cancelled' AND b.created_at>=NOW()-($1::text||' days')::interval WHERE h.status='active' GROUP BY h.id ORDER BY booking_value DESC,bookings DESC LIMIT 10`,[days])).rows;
 const topOffices=(await pool.query(`SELECT o.id,o.name,o.city,COUNT(d.id) deals,COALESCE(SUM(d.amount),0) deal_value,COALESCE(SUM(d.platform_commission),0) platform_commission FROM offices o LEFT JOIN office_deals d ON d.office_id=o.id AND d.status='completed' AND COALESCE(d.closed_at,d.created_at)>=NOW()-($1::text||' days')::interval GROUP BY o.id ORDER BY deal_value DESC,deals DESC LIMIT 10`,[days])).rows;
 const alerts=[];
 const pendingProperties=await one(`SELECT COUNT(*) v FROM properties WHERE status='pending'`); if(pendingProperties)alerts.push({level:'warning',title:'عقارات بانتظار المراجعة',value:pendingProperties});
 const unpaidInvoices=await one(`SELECT COUNT(*) v FROM electronic_invoices WHERE status IN ('issued','partially_paid') AND total_amount-paid_amount>0.01`); if(unpaidInvoices)alerts.push({level:'warning',title:'فواتير غير مكتملة السداد',value:unpaidInvoices});
 const payoutDrafts=await one(`SELECT COUNT(*) v FROM hotel_payout_cycles WHERE status IN ('draft','approved','processing')`); if(payoutDrafts)alerts.push({level:'info',title:'تسويات فنادق مفتوحة',value:payoutDrafts});
 const cancelledBookings=await one(`SELECT COUNT(*) v FROM hotel_bookings WHERE status='cancelled' AND updated_at>=NOW()-($1::text||' days')::interval`,[days]); if(cancelledBookings)alerts.push({level:'info',title:'حجوزات ملغاة خلال الفترة',value:cancelledBookings});
 const growth=previousRevenue>0?((currentRevenue-previousRevenue)/previousRevenue*100):(currentRevenue>0?100:0);
 const dailyRunRate=currentRevenue/days, forecast30=dailyRunRate*30;
 res.json({period:{days},kpis:{revenue:currentRevenue,expenses,profit:currentRevenue-expenses,revenue_growth_pct:growth,forecast_next_30_days:forecast30,bookings,booking_value:bookingValue,completed_deals:completedDeals,deal_value:dealValue,active_properties:properties,active_hotels:hotels,offices,active_users:users},monthly,cities,top_hotels:topHotels,top_offices:topOffices,alerts,forecast_note:'توقع بسيط مبني على متوسط الإيراد اليومي للفترة المختارة، وليس نموذجاً تنبؤياً مضموناً.'});
}catch(e){res.status(500).json({error:e.message})}});
// -------------------------------------------------------------------------


// V35 property intelligence ------------------------------------------------
function aiMedian(a){a=a.map(Number).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 0;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function aiNorm(s){return String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
function aiTokens(s){return new Set(aiNorm(s).split(/\s+/).filter(x=>x.length>2))}
function aiTextSim(a,b){const A=aiTokens(a),B=aiTokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size)}
async function calculatePropertyIntelligence(){
 const rows=(await pool.query(`SELECT id,title,type,mode,city,district,price,currency,area,rooms,baths,description,latitude,longitude,views_count,created_at FROM properties WHERE status='active'`)).rows;
 const results=[];
 for(const p of rows){
  const comps=rows.filter(x=>x.id!==p.id&&x.mode===p.mode&&x.type===p.type&&x.city===p.city&&(!p.district||!x.district||x.district===p.district)&&Number(x.area)>0&&Number(x.price)>0);
  const relaxed=comps.length>=3?comps:rows.filter(x=>x.id!==p.id&&x.mode===p.mode&&x.city===p.city&&Number(x.area)>0&&Number(x.price)>0);
  const sample=relaxed.slice(0,100), med=aiMedian(sample.map(x=>Number(x.price)/Number(x.area))), pps=Number(p.area)>0?Number(p.price)/Number(p.area):0;
  const estimated=med&&Number(p.area)>0?med*Number(p.area):Number(p.price),gap=estimated?((Number(p.price)-estimated)/estimated*100):0;
  const confidence=Math.min(95,25+sample.length*7+(p.district?8:0)+(Number(p.area)>0?8:0));
  let label=Math.abs(gap)<=10?'fair':gap>10?'above_market':'below_market';
  let dupRisk=0,dupId=null;
  for(const x of rows){if(x.id===p.id||x.city!==p.city)continue;let score=0;score+=aiTextSim(p.title+' '+(p.description||''),x.title+' '+(x.description||''))*55;if(p.district&&p.district===x.district)score+=12;if(p.type===x.type)score+=8;if(Number(p.area)&&Number(x.area)&&Math.abs(Number(p.area)-Number(x.area))/Math.max(Number(p.area),Number(x.area))<.03)score+=12;if(Number(p.price)&&Number(x.price)&&Math.abs(Number(p.price)-Number(x.price))/Math.max(Number(p.price),Number(x.price))<.03)score+=8;if(p.latitude&&x.latitude&&p.longitude&&x.longitude&&Math.abs(Number(p.latitude)-Number(x.latitude))<.0005&&Math.abs(Number(p.longitude)-Number(x.longitude))<.0005)score+=15;if(score>dupRisk){dupRisk=Math.min(100,score);dupId=x.id}}
  const rec=Math.max(0,Math.min(100,50+(label==='below_market'?20:label==='fair'?10:-5)+Math.min(15,Number(p.views_count||0)/10)+(confidence-50)/5-(dupRisk>=75?25:0)));
  const signals={comparables:sample.length,scope:comps.length>=3?'district':'city',algorithm:'robust-comparable-median-v1'};
  await pool.query(`INSERT INTO property_ai_scores(property_id,estimated_price,price_per_sqm,market_price_per_sqm,price_gap_pct,valuation_confidence,pricing_label,duplicate_risk,duplicate_property_id,recommendation_score,signals,calculated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) ON CONFLICT(property_id) DO UPDATE SET estimated_price=EXCLUDED.estimated_price,price_per_sqm=EXCLUDED.price_per_sqm,market_price_per_sqm=EXCLUDED.market_price_per_sqm,price_gap_pct=EXCLUDED.price_gap_pct,valuation_confidence=EXCLUDED.valuation_confidence,pricing_label=EXCLUDED.pricing_label,duplicate_risk=EXCLUDED.duplicate_risk,duplicate_property_id=EXCLUDED.duplicate_property_id,recommendation_score=EXCLUDED.recommendation_score,signals=EXCLUDED.signals,calculated_at=NOW()`,[p.id,estimated,pps,med,gap,confidence,label,dupRisk,dupRisk>=65?dupId:null,rec,JSON.stringify(signals)]);
  results.push({id:p.id,label,gap,dupRisk,rec});
 }
 return results;
}
app.post('/api/admin/property-ai/recalculate',requireAdmin,async(req,res)=>{try{const r=await calculatePropertyIntelligence();res.json({data:{processed:r.length}})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/admin/property-ai/dashboard',requireAdmin,async(req,res)=>{try{const rows=(await pool.query(`SELECT s.*,p.title,p.city,p.district,p.type,p.mode,p.price,p.currency,p.area,p.image_url,d.title duplicate_title FROM property_ai_scores s JOIN properties p ON p.id=s.property_id LEFT JOIN properties d ON d.id=s.duplicate_property_id ORDER BY ABS(s.price_gap_pct) DESC NULLS LAST LIMIT 300`)).rows;const summary=(await pool.query(`SELECT COUNT(*) total,COUNT(*) FILTER(WHERE pricing_label='above_market') above_market,COUNT(*) FILTER(WHERE pricing_label='below_market') below_market,COUNT(*) FILTER(WHERE pricing_label='fair') fair,COUNT(*) FILTER(WHERE duplicate_risk>=65) duplicate_alerts,ROUND(AVG(valuation_confidence),1) avg_confidence FROM property_ai_scores`)).rows[0];res.json({summary,data:rows,disclaimer:'التقدير تحليلي مبني على الإعلانات الداخلية المقارنة وليس تقييماً عقارياً معتمداً.'})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/properties/:id/intelligence',async(req,res)=>{try{const r=(await pool.query(`SELECT s.estimated_price,s.market_price_per_sqm,s.price_gap_pct,s.valuation_confidence,s.pricing_label,s.recommendation_score,s.calculated_at FROM property_ai_scores s JOIN properties p ON p.id=s.property_id WHERE s.property_id=$1 AND p.status='active'`,[req.params.id])).rows[0];if(!r)return res.status(404).json({error:'لا يوجد تحليل بعد'});res.json({data:r,disclaimer:'تقدير آلي إرشادي مبني على بيانات عقارتكم وليس تقييماً رسمياً.'})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/me/recommendations',requireAuth,async(req,res)=>{try{const prefs=(await pool.query(`SELECT p.city,p.type,p.mode,COUNT(*) n FROM favorites f JOIN properties p ON p.id=f.property_id WHERE f.user_id=$1 GROUP BY p.city,p.type,p.mode ORDER BY n DESC LIMIT 5`,[req.user.id])).rows;let where="p.status='active'",vals=[];if(prefs.length){vals.push(prefs.map(x=>x.city));where+=` AND p.city=ANY($${vals.length})`;vals.push(prefs.map(x=>x.type));where+=` AND p.type=ANY($${vals.length})`}const r=await pool.query(`SELECT p.*,COALESCE(s.recommendation_score,50) recommendation_score,s.pricing_label,s.price_gap_pct FROM properties p LEFT JOIN property_ai_scores s ON s.property_id=p.id WHERE ${where} AND NOT EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=$${vals.length+1} AND f.property_id=p.id) ORDER BY COALESCE(s.recommendation_score,50) DESC,p.featured DESC,p.created_at DESC LIMIT 20`,[...vals,req.user.id]);res.json({data:r.rows,personalized:prefs.length>0})}catch(e){res.status(500).json({error:e.message})}});
// V36 geographic market intelligence ---------------------------------------
async function buildMarketMap(){
 const rows=(await pool.query(`SELECT p.*,COALESCE(s.recommendation_score,50) recommendation_score FROM properties p LEFT JOIN property_ai_scores s ON s.property_id=p.id WHERE p.status='active' AND p.area>0 AND p.price>0`)).rows;
 const groups=new Map();
 for(const p of rows) for(const scope of ['city','district']){if(scope==='district'&&!p.district)continue;const key=[scope,p.city,scope==='district'?p.district:'',p.mode,p.type].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p)}
 let saved=0;
 for(const [key,a] of groups){const [scope,city,district,mode,type]=key.split('|');const pps=a.map(x=>Number(x.price)/Number(x.area)).filter(Number.isFinite);const med=aiMedian(pps),avg=pps.reduce((x,y)=>x+y,0)/(pps.length||1);const demand=Math.min(100,Math.round(a.reduce((n,x)=>n+Math.log1p(Number(x.views_count||0))*8,0)/(Math.max(1,a.length)) + Math.min(35,a.length*2)));const invest=Math.max(0,Math.min(100,Math.round(45+demand*.35+(a.reduce((n,x)=>n+Number(x.recommendation_score||50),0)/a.length-50)*.3)));const prev=(await pool.query(`SELECT median_price_per_sqm FROM property_market_snapshots WHERE scope_type=$1 AND city=$2 AND COALESCE(district,'')=$3 AND mode=$4 AND property_type=$5 AND snapshot_date<CURRENT_DATE ORDER BY snapshot_date DESC LIMIT 1`,[scope,city,district,mode,type])).rows[0];const trend=prev&&Number(prev.median_price_per_sqm)?(med-Number(prev.median_price_per_sqm))/Number(prev.median_price_per_sqm)*100:0;await pool.query(`INSERT INTO property_market_snapshots(scope_type,city,district,mode,property_type,listings_count,median_price_per_sqm,avg_price_per_sqm,demand_score,investment_score,price_trend_pct,snapshot_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_DATE) ON CONFLICT(scope_type,city,district,mode,property_type,snapshot_date) DO UPDATE SET listings_count=EXCLUDED.listings_count,median_price_per_sqm=EXCLUDED.median_price_per_sqm,avg_price_per_sqm=EXCLUDED.avg_price_per_sqm,demand_score=EXCLUDED.demand_score,investment_score=EXCLUDED.investment_score,price_trend_pct=EXCLUDED.price_trend_pct`,[scope,city,district||null,mode,type,a.length,med,avg,demand,invest,trend]);saved++}
 return saved;
}
app.post('/api/admin/market-map/recalculate',requireAdmin,async(req,res)=>{try{await calculatePropertyIntelligence();res.json({data:{processed:await buildMarketMap()}})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/market-map',async(req,res)=>{try{const {city='',mode='',type=''}=req.query;const vals=[],w=[`snapshot_date=(SELECT MAX(snapshot_date) FROM property_market_snapshots)`];if(city){vals.push(city);w.push(`city=$${vals.length}`)}if(mode){vals.push(mode);w.push(`mode=$${vals.length}`)}if(type){vals.push(type);w.push(`property_type=$${vals.length}`)}const data=(await pool.query(`SELECT * FROM property_market_snapshots WHERE ${w.join(' AND ')} ORDER BY investment_score DESC,demand_score DESC`,vals)).rows;res.json({data,disclaimer:'مؤشرات تحليلية مبنية على بيانات إعلانات عقارتكم الداخلية وليست مؤشراً سعرياً رسمياً.'})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/admin/market-map/dashboard',requireAdmin,async(req,res)=>{try{const latest=`snapshot_date=(SELECT MAX(snapshot_date) FROM property_market_snapshots)`;const rows=(await pool.query(`SELECT * FROM property_market_snapshots WHERE ${latest} ORDER BY investment_score DESC LIMIT 250`)).rows;const cities=(await pool.query(`SELECT city,ROUND(AVG(median_price_per_sqm),2) price_per_sqm,ROUND(AVG(demand_score),1) demand_score,ROUND(AVG(investment_score),1) investment_score,ROUND(AVG(price_trend_pct),2) price_trend_pct,SUM(listings_count) listings FROM property_market_snapshots WHERE ${latest} AND scope_type='city' GROUP BY city ORDER BY investment_score DESC`)).rows;const hot=(await pool.query(`SELECT city,district,mode,property_type,median_price_per_sqm,demand_score,investment_score,price_trend_pct,listings_count FROM property_market_snapshots WHERE ${latest} AND scope_type='district' ORDER BY investment_score DESC,demand_score DESC LIMIT 20`)).rows;res.json({data:rows,cities,hotspots:hot})}catch(e){res.status(500).json({error:e.message})}});
// V37 interactive geographic heatmap ---------------------------------------
app.get('/api/admin/market-map/geo',requireAdmin,async(req,res)=>{try{
 const {city='',mode='',type=''}=req.query;const vals=[],w=["p.status='active'","p.latitude IS NOT NULL","p.longitude IS NOT NULL"];
 if(city){vals.push(city);w.push(`p.city=$${vals.length}`)}if(mode){vals.push(mode);w.push(`p.mode=$${vals.length}`)}if(type){vals.push(type);w.push(`p.type=$${vals.length}`)}
 const points=(await pool.query(`SELECT p.id,p.title,p.city,p.district,p.type,p.mode,p.price,p.currency,p.area,p.latitude,p.longitude,p.views_count,CASE WHEN p.area>0 THEN p.price/p.area ELSE NULL END price_per_sqm,COALESCE(ai.recommendation_score,50) investment_score,COALESCE(ai.valuation_confidence,0) confidence FROM properties p LEFT JOIN property_ai_scores ai ON ai.property_id=p.id WHERE ${w.join(' AND ')} ORDER BY p.views_count DESC NULLS LAST LIMIT 3000`,vals)).rows;
 const districts=(await pool.query(`SELECT p.city,COALESCE(p.district,'') district,AVG(p.latitude)::float latitude,AVG(p.longitude)::float longitude,COUNT(*) listings,percentile_cont(.5) WITHIN GROUP(ORDER BY p.price/NULLIF(p.area,0))::float price_per_sqm,AVG(COALESCE(p.views_count,0))::float avg_views,AVG(COALESCE(ai.recommendation_score,50))::float investment_score FROM properties p LEFT JOIN property_ai_scores ai ON ai.property_id=p.id WHERE ${w.join(' AND ')} AND p.area>0 GROUP BY p.city,COALESCE(p.district,'') HAVING COUNT(*)>=1 ORDER BY listings DESC`,vals)).rows;
 res.json({points,districts,disclaimer:'الخريطة الحرارية تحليل إرشادي مبني على إعلانات وتفاعل مستخدمي عقارتكم، وليست تقييماً رسمياً.'});
}catch(e){res.status(500).json({error:e.message})}});
// V38 automatic geocoding / map coverage ----------------------------------
function geocodeQuery(p){return [p.address,p.district,p.city,process.env.GEOCODER_COUNTRY_HINT||'سوريا'].filter(Boolean).join(', ')}
async function geocodeOne(property){
 const q=geocodeQuery(property);if(!q)return {ok:false,error:'لا يوجد عنوان كافٍ'};
 const base=process.env.GEOCODER_BASE_URL||'https://nominatim.openstreetmap.org/search';
 const u=new URL(base);u.searchParams.set('q',q);u.searchParams.set('format','jsonv2');u.searchParams.set('limit','1');u.searchParams.set('addressdetails','1');
 const r=await fetch(u,{headers:{'User-Agent':process.env.GEOCODER_USER_AGENT||'Aqartkom/1.0 (admin geocoding)','Accept-Language':'ar,en'}});if(!r.ok)throw Error('Geocoder HTTP '+r.status);
 const a=await r.json();if(!Array.isArray(a)||!a[0])return {ok:false,error:'لم يتم العثور على الموقع',query:q};const x=a[0],lat=Number(x.lat),lng=Number(x.lon);if(!Number.isFinite(lat)||!Number.isFinite(lng))return {ok:false,error:'إحداثيات غير صالحة',query:q};
 return {ok:true,query:q,lat,lng,confidence:Math.min(100,Math.round(Number(x.importance||.5)*100)),raw:x};
}
app.get('/api/admin/geocoding/coverage',requireAdmin,async(req,res)=>{try{const x=(await pool.query(`SELECT COUNT(*) total,COUNT(*) FILTER(WHERE latitude IS NOT NULL AND longitude IS NOT NULL) mapped,COUNT(*) FILTER(WHERE latitude IS NULL OR longitude IS NULL) missing FROM properties WHERE status='active'`)).rows[0];const jobs=(await pool.query(`SELECT status,COUNT(*) count FROM property_geocoding_jobs GROUP BY status`)).rows;const missing=(await pool.query(`SELECT id,title,city,district,address FROM properties WHERE status='active' AND (latitude IS NULL OR longitude IS NULL) ORDER BY created_at DESC LIMIT 100`)).rows;res.json({coverage:x,jobs,missing})}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/admin/geocoding/run',requireAdmin,async(req,res)=>{try{const limit=Math.max(1,Math.min(50,Number(req.body?.limit||20)));const rows=(await pool.query(`SELECT id,title,city,district,address FROM properties WHERE status='active' AND (latitude IS NULL OR longitude IS NULL) ORDER BY created_at ASC LIMIT $1`,[limit])).rows;let success=0,failed=0;for(const p of rows){let g;try{g=await geocodeOne(p)}catch(e){g={ok:false,error:e.message,query:geocodeQuery(p)}}if(g.ok){await pool.query(`UPDATE properties SET latitude=$1,longitude=$2,updated_at=NOW() WHERE id=$3`,[g.lat,g.lng,p.id]);success++}else failed++;await pool.query(`INSERT INTO property_geocoding_jobs(property_id,query_text,status,latitude,longitude,confidence,provider_payload,error_message,attempts,processed_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,NOW(),NOW()) ON CONFLICT(property_id) DO UPDATE SET query_text=EXCLUDED.query_text,status=EXCLUDED.status,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,confidence=EXCLUDED.confidence,provider_payload=EXCLUDED.provider_payload,error_message=EXCLUDED.error_message,attempts=property_geocoding_jobs.attempts+1,processed_at=NOW(),updated_at=NOW()`,[p.id,g.query||geocodeQuery(p),g.ok?'success':'failed',g.lat||null,g.lng||null,g.confidence||null,JSON.stringify(g.raw||{}),g.error||null]);if(rows.length>1)await new Promise(r=>setTimeout(r,Number(process.env.GEOCODER_DELAY_MS||1100)))}res.json({data:{scanned:rows.length,success,failed}})}catch(e){res.status(500).json({error:e.message})}});
app.patch('/api/admin/properties/:id/location',requireAdmin,async(req,res)=>{try{const lat=Number(req.body?.latitude),lng=Number(req.body?.longitude);if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lng)||lng<-180||lng>180)return res.status(400).json({error:'الإحداثيات غير صالحة'});const p=(await pool.query(`UPDATE properties SET latitude=$1,longitude=$2,updated_at=NOW() WHERE id=$3 RETURNING id,title,latitude,longitude`,[lat,lng,req.params.id])).rows[0];if(!p)return res.status(404).json({error:'العقار غير موجود'});await pool.query(`INSERT INTO property_geocoding_jobs(property_id,query_text,status,latitude,longitude,confidence,attempts,processed_at,updated_at) VALUES($1,'manual','manual',$2,$3,100,1,NOW(),NOW()) ON CONFLICT(property_id) DO UPDATE SET status='manual',latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,confidence=100,processed_at=NOW(),updated_at=NOW()`,[p.id,lat,lng]);res.json({data:p})}catch(e){res.status(500).json({error:e.message})}});
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------

// V40 personalized property recommendations --------------------------------
const REC_EVENT_WEIGHT={view:1,favorite:5,inquiry:8,recommendation_click:3,dismiss:-4};
async function recordPropertyEvent(userId,propertyId,eventType,metadata={}){
  if(!userId||!propertyId||!(eventType in REC_EVENT_WEIGHT))return;
  await pool.query(`INSERT INTO user_property_events(user_id,property_id,event_type,weight,metadata) VALUES($1,$2,$3,$4,$5)`,[userId,propertyId,eventType,REC_EVENT_WEIGHT[eventType],JSON.stringify(metadata||{})]);
}
function topWeighted(rows,key){const m=new Map();for(const r of rows){const v=String(r[key]||'').trim();if(v)m.set(v,(m.get(v)||0)+Number(r.signal_weight||0))}return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([value,weight])=>({value,weight:Math.round(weight*10)/10}))}
async function buildRecommendationProfile(userId){
  const signals=(await pool.query(`SELECT p.id,p.city,p.district,p.type,p.mode,p.currency,p.price,p.area,e.weight*CASE WHEN e.created_at>NOW()-INTERVAL '30 days' THEN 1.0 WHEN e.created_at>NOW()-INTERVAL '90 days' THEN .7 ELSE .4 END signal_weight FROM user_property_events e JOIN properties p ON p.id=e.property_id WHERE e.user_id=$1 AND e.created_at>NOW()-INTERVAL '365 days' UNION ALL SELECT p.id,p.city,p.district,p.type,p.mode,p.currency,p.price,p.area,5 signal_weight FROM favorites f JOIN properties p ON p.id=f.property_id WHERE f.user_id=$1 UNION ALL SELECT p.id,p.city,p.district,p.type,p.mode,p.currency,p.price,p.area,8 signal_weight FROM inquiries i JOIN properties p ON p.id=i.property_id WHERE i.sender_id=$1`,[userId])).rows;
  const saved=(await pool.query(`SELECT filters,currency FROM saved_searches WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 20`,[userId])).rows;
  for(const x of saved){const f=x.filters||{};signals.push({city:f.city,district:f.district,type:f.type,mode:f.mode,currency:x.currency,price:Number(f.maxPrice||f.minPrice||0)||null,area:null,signal_weight:3})}
  const positive=signals.filter(x=>Number(x.signal_weight)>0), prices=positive.filter(x=>Number(x.price)>0).map(x=>Number(x.price));
  const profile={cities:topWeighted(positive,'city'),districts:topWeighted(positive,'district'),types:topWeighted(positive,'type'),modes:topWeighted(positive,'mode'),currencies:topWeighted(positive,'currency'),price_min:prices.length?Math.min(...prices):null,price_max:prices.length?Math.max(...prices):null};
  const confidence=Math.min(100,Math.round(positive.length*8));
  await pool.query(`INSERT INTO user_recommendation_profiles(user_id,profile,signal_count,confidence,calculated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(user_id) DO UPDATE SET profile=EXCLUDED.profile,signal_count=EXCLUDED.signal_count,confidence=EXCLUDED.confidence,calculated_at=NOW()`,[userId,JSON.stringify(profile),positive.length,confidence]);
  return {profile,signal_count:positive.length,confidence};
}
function prefWeight(arr,val){const x=(arr||[]).find(i=>String(i.value)===String(val||''));return x?Number(x.weight||0):0}
async function recommendationsFor(userId,limit=12){
  const pr=await buildRecommendationProfile(userId), p=pr.profile;
  const rows=(await pool.query(`SELECT p.*,COALESCE(ai.pricing_label,'') pricing_label,COALESCE(ai.recommendation_score,50) market_score,(SELECT pi.url FROM property_images pi WHERE pi.property_id=p.id ORDER BY pi.sort_order,pi.id LIMIT 1) image_url,(SELECT json_build_object('id',pv.id,'url',pv.url,'poster_url',pv.poster_url,'title',pv.title,'source_type',pv.source_type,'is_primary',pv.is_primary) FROM property_videos pv WHERE pv.property_id=p.id ORDER BY pv.is_primary DESC,pv.created_at DESC LIMIT 1) primary_video FROM properties p LEFT JOIN property_ai_scores ai ON ai.property_id=p.id WHERE p.status='active' AND p.owner_id IS DISTINCT FROM $1 AND NOT EXISTS(SELECT 1 FROM user_property_events e WHERE e.user_id=$1 AND e.property_id=p.id AND e.event_type='dismiss' AND e.created_at>NOW()-INTERVAL '90 days') ORDER BY p.featured DESC,p.created_at DESC LIMIT 800`,[userId])).rows;
  const scored=rows.map(x=>{let score=20,reasons=[];const cw=prefWeight(p.cities,x.city),dw=prefWeight(p.districts,x.district),tw=prefWeight(p.types,x.type),mw=prefWeight(p.modes,x.mode);if(cw>0){score+=Math.min(25,cw*2);reasons.push('مدينة تهتم بها')}if(dw>0){score+=Math.min(20,dw*2);reasons.push('حي قريب من اهتماماتك')}if(tw>0){score+=Math.min(20,tw*2);reasons.push('نوع عقار تفضله')}if(mw>0){score+=Math.min(15,mw*2);reasons.push(x.mode==='بيع'?'يناسب اهتمامك بالشراء':'يناسب اهتمامك بالإيجار')}if(p.price_min&&p.price_max&&Number(x.price)>=p.price_min*.75&&Number(x.price)<=p.price_max*1.25){score+=10;reasons.push('ضمن نطاق سعري مناسب')}if(x.pricing_label==='under_market'){score+=8;reasons.push('فرصة سعرية حسب تحليل السوق')}score+=Math.min(8,Number(x.market_score||50)/12.5);return {...x,personal_score:Math.min(100,Math.round(score)),recommendation_reason:reasons.slice(0,3).join(' • ')||'عقار نشط قد يناسبك'}}).sort((a,b)=>b.personal_score-a.personal_score||new Date(b.created_at)-new Date(a.created_at)).slice(0,limit);
  for(const x of scored)await pool.query(`INSERT INTO property_recommendation_impressions(user_id,property_id,score,reason,shown_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(user_id,property_id) DO UPDATE SET score=EXCLUDED.score,reason=EXCLUDED.reason,shown_at=NOW()`,[userId,x.id,x.personal_score,x.recommendation_reason]);
  return {data:scored,profile:pr,cold_start:pr.signal_count<3};
}
app.get('/api/me/recommendations',requireAuth,async(req,res)=>{try{res.json(await recommendationsFor(req.user.id,Math.max(1,Math.min(30,Number(req.query.limit||12)))))}catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل العقارات المقترحة'})}});
app.post('/api/me/property-events/:propertyId',requireAuth,async(req,res)=>{try{const t=String(req.body?.event_type||'view');if(!(t in REC_EVENT_WEIGHT))return res.status(400).json({error:'نوع التفاعل غير مدعوم'});await recordPropertyEvent(req.user.id,Number(req.params.propertyId),t,req.body?.metadata||{});if(t==='recommendation_click')await pool.query(`UPDATE property_recommendation_impressions SET clicked_at=NOW() WHERE user_id=$1 AND property_id=$2`,[req.user.id,Number(req.params.propertyId)]);res.json({ok:true})}catch(e){res.status(500).json({error:'تعذر تسجيل التفاعل'})}});
app.post('/api/me/recommendations/rebuild',requireAuth,async(req,res)=>{try{res.json({data:await buildRecommendationProfile(req.user.id)})}catch(e){res.status(500).json({error:'تعذر تحديث ملف التوصيات'})}});
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------


// V41 conversational property assistant ------------------------------------
const ASSISTANT_CITIES=['دمشق','ريف دمشق','حلب','حمص','حماة','اللاذقية','طرطوس','درعا','السويداء','دير الزور','الرقة','الحسكة','إدلب','القنيطرة'];
const ASSISTANT_TYPES=['شقة','منزل','فيلا','أرض','محل تجاري','مكتب','مزرعة','بناء'];
function arDigits(s){return String(s||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))}
function parseMoneyText(text){const t=arDigits(text).replace(/,/g,'');let currency=/دولار|\bUSD\b/i.test(t)?'USD':/ريال|\bSAR\b/i.test(t)?'SAR':/ليرة|\bSYP\b/i.test(t)?'SYP':/يورو|\bEUR\b/i.test(t)?'EUR':null;let m=t.match(/(?:حدود|بحدود|حتى|ميزاني(?:ة|تي)|بسعر|أقل من|لا يتجاوز)\s*(\d+(?:\.\d+)?)\s*(ألف|مليون)?/i)||t.match(/(\d+(?:\.\d+)?)\s*(ألف|مليون)?\s*(?:دولار|ريال|ليرة|يورو|USD|SAR|SYP|EUR)/i);if(!m)return {currency};let n=Number(m[1]);if(m[2]==='ألف')n*=1000;if(m[2]==='مليون')n*=1000000;return {maxPrice:n,currency}}
function parseAssistantQuery(text){const t=arDigits(text).trim(), f={};const city=ASSISTANT_CITIES.find(x=>t.includes(x));if(city)f.city=city;const type=ASSISTANT_TYPES.find(x=>t.includes(x));if(type)f.type=type;if(/إيجار|استئجار|استأجر|للإيجار/.test(t))f.mode='إيجار';else if(/شراء|اشتري|أشتري|للبيع|بيع/.test(t))f.mode='بيع';const rooms=t.match(/(\d+)\s*(?:غرف|غرفة)/);if(rooms)f.rooms=Number(rooms[1]);const area=t.match(/(?:مساحة|حوالي)\s*(\d+)\s*(?:م|متر)/);if(area)f.minArea=Math.round(Number(area[1])*.8),f.maxArea=Math.round(Number(area[1])*1.2);Object.assign(f,parseMoneyText(t));return f}
async function assistantSearch(filters){let w=["p.status='active'"],v=[];const add=(sql,val)=>{v.push(val);w.push(sql.replace('?',`$${v.length}`))};if(filters.city)add('p.city=?',filters.city);if(filters.type)add('p.type=?',filters.type);if(filters.mode)add('p.mode=?',filters.mode);if(filters.rooms){v.push(filters.rooms);w.push(`p.rooms >= $${v.length}`)}if(filters.minArea){v.push(filters.minArea);w.push(`p.area >= $${v.length}`)}if(filters.maxArea){v.push(filters.maxArea);w.push(`p.area <= $${v.length}`)}if(filters.maxPrice){v.push(filters.maxPrice);w.push(`p.price <= $${v.length}`)}if(filters.currency){v.push(filters.currency);w.push(`UPPER(COALESCE(p.currency,'USD'))=$${v.length}`)}let r=await pool.query(`SELECT p.id,p.title,p.is_demo,p.type,p.mode,p.city,p.district,p.price,p.currency,p.area,p.rooms,p.baths,p.image_url,COALESCE(ai.recommendation_score,50) market_score,ai.pricing_label,ai.price_gap_pct FROM properties p LEFT JOIN property_ai_scores ai ON ai.property_id=p.id WHERE ${w.join(' AND ')} ORDER BY CASE WHEN ai.pricing_label='below_market' THEN 0 ELSE 1 END,COALESCE(ai.recommendation_score,50) DESC,p.featured DESC,p.created_at DESC LIMIT 8`,v);return r.rows}
app.post('/api/property-assistant/chat',async(req,res)=>{try{const text=String(req.body?.message||'').trim();if(text.length<2)return res.status(400).json({error:'اكتب طلبك العقاري'});const user=await getCurrentUser(req);const parsed=parseAssistantQuery(text);let sid=Number(req.body?.session_id)||null, previous={};if(sid){const q=(await pool.query(`SELECT * FROM property_assistant_sessions WHERE id=$1 AND (user_id IS NULL OR user_id=$2)`,[sid,user?.id||null])).rows[0];if(q)previous=q.parsed_filters||{};else sid=null}const filters={...previous,...parsed};const results=await assistantSearch(filters);const missing=[];if(!filters.city)missing.push('المدينة');if(!filters.mode)missing.push('شراء أم إيجار');if(!filters.type)missing.push('نوع العقار');let reply;if(results.length){reply=`وجدت ${results.length} خيارات مناسبة${filters.city?' في '+filters.city:''}. رتبتها مع إعطاء أفضلية للفرص السعرية وتحليل السوق الداخلي.`}else if(missing.length){reply=`لم أجد نتيجة دقيقة بعد. أخبرني ${missing.slice(0,2).join(' و')} لأبحث بشكل أفضل.`}else reply='لم أجد عقاراً مطابقاً تماماً. جرّب رفع الميزانية أو توسيع المنطقة أو تغيير عدد الغرف.';if(!sid){sid=(await pool.query(`INSERT INTO property_assistant_sessions(user_id,last_query,parsed_filters,result_count) VALUES($1,$2,$3,$4) RETURNING id`,[user?.id||null,text,JSON.stringify(filters),results.length])).rows[0].id}else await pool.query(`UPDATE property_assistant_sessions SET last_query=$1,parsed_filters=$2,result_count=$3,updated_at=NOW() WHERE id=$4`,[text,JSON.stringify(filters),results.length,sid]);await pool.query(`INSERT INTO property_assistant_messages(session_id,role,content,metadata) VALUES($1,'user',$2,$3),($1,'assistant',$4,$5)`,[sid,text,JSON.stringify({parsed}),reply,JSON.stringify({filters,result_ids:results.map(x=>x.id)})]);res.json({session_id:sid,reply,filters,missing,results,disclaimer:'المساعد يفهم الطلب ويبحث في بيانات عقارتكم؛ ترتيب السعر وتحليل السوق إرشاديان وليسا تقييماً عقارياً رسمياً.'})}catch(e){console.error(e);res.status(500).json({error:'تعذر تنفيذ البحث الذكي'})}});
app.post('/api/property-assistant/reset',async(req,res)=>{res.json({ok:true})});

// V42 full property advisor -------------------------------------------------
async function advisorProperties(ids){
 const clean=[...new Set((ids||[]).map(Number).filter(Number.isFinite))].slice(0,5); if(!clean.length)return [];
 const r=await pool.query(`SELECT p.id,p.title,p.is_demo,p.type,p.mode,p.city,p.district,p.price,p.currency,p.area,p.rooms,p.baths,p.views_count,p.description,p.image_url,
 CASE WHEN p.area>0 THEN p.price/p.area ELSE NULL END price_per_sqm, ai.estimated_price,ai.market_price_per_sqm,ai.price_gap_pct,ai.valuation_confidence,ai.pricing_label,COALESCE(ai.recommendation_score,50) market_score
 FROM properties p LEFT JOIN property_ai_scores ai ON ai.property_id=p.id WHERE p.status='active' AND p.id=ANY($1::bigint[])`,[clean]);
 return clean.map(id=>r.rows.find(x=>Number(x.id)===id)).filter(Boolean);
}
function advisorMetrics(p,ass={}){
 const price=Number(p.price||0),area=Number(p.area||0),pps=area?price/area:null;
 const annualRent=Number(ass.annual_rent?.[p.id]||ass.annual_rent||0);
 const expenses=Number(ass.annual_expenses?.[p.id]||ass.annual_expenses||0);
 const grossYield=price>0&&annualRent>0?annualRent/price*100:null;
 const netYield=price>0&&annualRent>0?(annualRent-expenses)/price*100:null;
 const pros=[],cons=[];
 if(p.pricing_label==='below_market'){pros.push('السعر أقل من السوق وفق بيانات عقارتكم الداخلية')}
 if(Number(p.market_score)>=70)pros.push('درجة فرصة سوقية مرتفعة');
 if(Number(p.valuation_confidence)>=70)pros.push('ثقة جيدة في المقارنات السعرية المتاحة');
 if(p.rooms>=3)pros.push('عدد غرف مناسب للعائلات');
 if(p.pricing_label==='above_market')cons.push('السعر أعلى من السوق وفق المقارنات الداخلية');
 if(Number(p.valuation_confidence)<40)cons.push('بيانات المقارنة السعرية محدودة');
 if(!area)cons.push('المساحة غير متوفرة لحساب سعر المتر');
 if(p.mode==='بيع'&&!annualRent)cons.push('لم يُدخل إيجار سنوي، لذلك لا يمكن حساب العائد الاستثماري');
 return {...p,price_per_sqm:pps,gross_yield_pct:grossYield,net_yield_pct:netYield,annual_rent:annualRent||null,annual_expenses:expenses||null,pros,cons};
}
function advisorVerdict(rows){
 if(!rows.length)return null;
 const scored=rows.map(x=>{let s=Number(x.market_score||50);if(x.pricing_label==='below_market')s+=15;if(x.pricing_label==='above_market')s-=12;if(x.net_yield_pct!=null)s+=Math.min(20,x.net_yield_pct*2);return {...x,advisor_score:Math.max(0,Math.min(100,Math.round(s)))}}).sort((a,b)=>b.advisor_score-a.advisor_score);
 return {best:scored[0],ranking:scored.map(x=>({id:x.id,title:x.title,score:x.advisor_score})),summary:`الخيار الأعلى حسب البيانات المتاحة هو «${scored[0].title}» بدرجة ${scored[0].advisor_score}/100. القرار النهائي يجب أن يراعي الفحص الميداني والوثائق والتكاليف الفعلية.`};
}
app.post('/api/property-advisor/compare',async(req,res)=>{try{const user=await getCurrentUser(req);const rows=(await advisorProperties(req.body?.property_ids)).map(p=>advisorMetrics(p,req.body?.assumptions||{}));if(rows.length<2)return res.status(400).json({error:'اختر عقارين على الأقل للمقارنة'});const verdict=advisorVerdict(rows);const result={properties:rows,verdict,disclaimer:'الحسابات استرشادية مبنية على بيانات عقارتكم وافتراضات المستخدم، وليست تقييماً أو نصيحة استثمارية معتمدة.'};await pool.query(`INSERT INTO property_advisor_comparisons(user_id,property_ids,assumptions,result) VALUES($1,$2,$3,$4)`,[user?.id||null,JSON.stringify(rows.map(x=>x.id)),JSON.stringify(req.body?.assumptions||{}),JSON.stringify(result)]);res.json(result)}catch(e){console.error(e);res.status(500).json({error:'تعذر تنفيذ المقارنة'})}});
app.get('/api/property-advisor/property/:id',async(req,res)=>{try{const rows=await advisorProperties([req.params.id]);if(!rows[0])return res.status(404).json({error:'العقار غير موجود'});const data=advisorMetrics(rows[0],{annual_rent:req.query.annual_rent,annual_expenses:req.query.annual_expenses});res.json({data,disclaimer:'العائد والسعر للمتر مؤشرات استرشادية وليست تقييماً رسمياً.'})}catch(e){res.status(500).json({error:'تعذر تحليل العقار'})}});
app.get('/api/property-advisor/market',async(req,res)=>{try{const city=String(req.query.city||'').trim(),district=String(req.query.district||'').trim(),currency=String(req.query.currency||'USD').toUpperCase();let v=[currency],w=[`p.status='active'`,`UPPER(COALESCE(p.currency,'USD'))=$1`,`p.area>0`];if(city){v.push(city);w.push(`p.city=$${v.length}`)}if(district){v.push(district);w.push(`p.district=$${v.length}`)}const q=(await pool.query(`SELECT COUNT(*)::int listings,percentile_cont(.5) WITHIN GROUP(ORDER BY p.price/NULLIF(p.area,0))::float median_price_per_sqm,AVG(p.price/NULLIF(p.area,0))::float avg_price_per_sqm,AVG(COALESCE(ai.recommendation_score,50))::float opportunity_score,AVG(COALESCE(p.views_count,0))::float avg_views FROM properties p LEFT JOIN property_ai_scores ai ON ai.property_id=p.id WHERE ${w.join(' AND ')}`,v)).rows[0];res.json({scope:{city:city||null,district:district||null,currency},data:q,disclaimer:'ملخص السوق يعتمد على الإعلانات النشطة داخل عقارتكم فقط.'})}catch(e){res.status(500).json({error:'تعذر تحميل ملخص السوق'})}});

// -------------------------------------------------------------------------


require('./ai-operations-manager')(app,{pool,getCurrentUser,requireAdmin});
require('./ai-sales-agent')(app,{pool,getCurrentUser,requireAdmin});
const whatsappSales=require('./whatsapp-sales')(app,{pool});
require('./ai-followup-agent')(app,{pool,requireAdmin,whatsapp:whatsappSales});
require('./ai-viewing-appointments')(app,{pool,requireAdmin,whatsapp:whatsappSales});
require('./ai-post-viewing')(app,{pool,requireAdmin,whatsapp:whatsappSales});
require('./ai-negotiation-manager')(app,{pool,requireOfficeMember,requireAdmin});
require('./econtract-manager')(app,{pool,requireOfficeMember,requireAdmin});
require('./deal-closing-manager')(app,{pool,requireOfficeMember,requireAdmin});
require('./owner-command-center')(app,{pool,requireAdmin});
require('./owner-unified-dashboard')(app,{pool,requireAdmin});
require('./ai-executive-manager')(app,{pool,requireAdmin});
require('./realtime-voice')(app,{requireAdmin});
require('./production-readiness')(app,{pool,requireAdmin});
require('./ai-marketing-growth')(app,{pool,requireAdmin});
require('./ad-platform-connectors')(app,{pool,requireAdmin});
require('./ai-ads-autopilot')(app,{pool,requireAdmin});
require('./daily-executive-report')(app,{pool,requireAdmin,whatsapp:whatsappSales});
require('./business-autopilot')(app,{pool,requireAdmin});
require('./ai-fraud-trust-center')(app,{pool,requireAdmin});
require('./property-ownership-verification')(app,{pool,getCurrentUser,requireAdmin});
require('./ai-listing-studio')(app,{pool,getCurrentUser,requireAdmin});
require('./ai-virtual-staging')(app,{pool,getCurrentUser,requireAdmin});
require('./ai-property-video-studio')(app,{pool,getCurrentUser,requireAdmin});
require('./lead-attribution-roi')(app,{pool,requireAdmin});
require('./ai-marketing-budget-optimizer')(app,{pool,requireAdmin});
require('./ai-demand-forecast')(app,{pool,requireAdmin});
// V81 AI Investor Portfolio Manager
require('./ai-investor-portfolio')(app,{pool});
// V82 AI Property Matchmaker
await require('./ai-property-matchmaker')(app,{pool,getCurrentUser});
require('./ai-marketplace-agent')(app,{pool,getCurrentUser});
// V84 AI Deal Room
require('./ai-deal-room')(app,{pool,getCurrentUser,requireAdmin});
// V85 AI Transaction Coordinator
require('./ai-transaction-coordinator')(app,{pool,getCurrentUser});
// V86 AI Neighborhood Guide
require('./ai-neighborhood-guide')(app,{pool,requireAdmin});
// V87 AI Property Comparison
require('./ai-property-comparison')(app,{pool});
// V89 Smart Property Request
await require('./ai-property-request')(app,{pool,getCurrentUser});
// V90 Property Request Tracking
await require('./property-request-tracking')(app,{pool,getCurrentUser,requireOfficeMember});
// V91 Request Messaging & Notifications
await require('./request-messaging-center')(app,{pool,getCurrentUser});
require('./chatgpt-manager')(app,{pool,getCurrentUser,requireAdmin});
app.use((_req,res)=>res.status(404).json({error:'المسار غير موجود'}));
await ensureAdminFromEnv();
try {
  const hotelDemoImport=await require('./demo-hotels').seedRequestedBatch(pool,normalizeEmail(process.env.ADMIN_EMAIL));
  if(!hotelDemoImport.skipped)console.log('Requested demo hotels imported:',hotelDemoImport.created);
  else if(hotelDemoImport.reason)console.warn('Requested demo hotels pending:',hotelDemoImport.reason);
} catch(error) { console.error('Requested demo hotel import failed:',error.message); }
const demoImport=await require('./demo-listings').seedDemoListings(pool);
if(!demoImport.skipped)console.log('Demo listings imported:',demoImport.created);
const mareiImport=await require('./marei-listings').seedMareiListings(pool);
if(!mareiImport.skipped)console.log('Marei references imported:',mareiImport.created);
await pool.query("UPDATE properties SET status='rejected' WHERE is_demo=TRUE AND status='active'");
app.listen(port,()=>console.log(`عقارتكم يعمل على http://localhost:${port}`));
}
bootstrap().catch(error=>{console.error('Database initialization failed:',error);process.exit(1);});
