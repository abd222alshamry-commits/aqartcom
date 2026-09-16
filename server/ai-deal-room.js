'use strict';
module.exports=function installAIDealRoom(app,{pool,getCurrentUser,requireAdmin}){
 async function ensure(){await pool.query(`
 CREATE TABLE IF NOT EXISTS ai_deal_rooms(
  id BIGSERIAL PRIMARY KEY, deal_id BIGINT NOT NULL UNIQUE REFERENCES office_deals(id) ON DELETE CASCADE,
  thread_id BIGINT REFERENCES ai_marketplace_threads(id) ON DELETE SET NULL, office_id BIGINT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  property_id BIGINT REFERENCES properties(id) ON DELETE SET NULL, lead_id BIGINT REFERENCES office_leads(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open', created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS ai_deal_room_documents(
  id BIGSERIAL PRIMARY KEY,room_id BIGINT NOT NULL REFERENCES ai_deal_rooms(id) ON DELETE CASCADE,document_type VARCHAR(50) NOT NULL,
  title VARCHAR(220) NOT NULL,url TEXT,external_entity_type VARCHAR(50),external_entity_id BIGINT,status VARCHAR(30) NOT NULL DEFAULT 'available',
  added_by BIGINT REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS ai_deal_room_events(
  id BIGSERIAL PRIMARY KEY,room_id BIGINT NOT NULL REFERENCES ai_deal_rooms(id) ON DELETE CASCADE,actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(60) NOT NULL,payload JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_deal_room_events ON ai_deal_room_events(room_id,created_at DESC);
 `)}
 async function user(req){return await getCurrentUser(req)}
 async function roomAccess(id,u){
  const q=await pool.query(`SELECT r.*,d.mode,d.amount,d.status deal_status,d.platform_commission_rate,d.platform_commission,d.commission_payer,
   p.title property_title,p.city,p.district,p.price property_price,p.currency property_currency,p.owner_id,
   l.name lead_name,l.phone lead_phone,l.email lead_email,l.stage lead_stage,
   t.buyer_user_id,t.seller_user_id
   FROM ai_deal_rooms r JOIN office_deals d ON d.id=r.deal_id LEFT JOIN properties p ON p.id=r.property_id LEFT JOIN office_leads l ON l.id=r.lead_id
   LEFT JOIN ai_marketplace_threads t ON t.id=r.thread_id WHERE r.id=$1`,[id]);
  const r=q.rows[0];if(!r)return null;if(u?.role==='admin')return r;
  const om=await pool.query(`SELECT 1 FROM office_members WHERE office_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,[r.office_id,u?.id||0]).catch(()=>({rows:[]}));
  if(Number(r.owner_id)===Number(u?.id)||Number(r.buyer_user_id)===Number(u?.id)||Number(r.seller_user_id)===Number(u?.id)||om.rows[0])return r;return null;
 }
 async function buildTimeline(r){
  const [ap,offers,agreement,contract,closure,events,docs]=await Promise.all([
   pool.query(`SELECT id,starts_at,ends_at,status,notes FROM office_appointments WHERE property_id=$1 AND ($2::bigint IS NULL OR lead_id=$2) ORDER BY starts_at DESC LIMIT 10`,[r.property_id,r.lead_id]),
   pool.query(`SELECT id,offer_type,amount,currency,status,terms,created_at FROM negotiation_offers WHERE deal_id=$1 ORDER BY created_at DESC`,[r.deal_id]).catch(()=>({rows:[]})),
   pool.query(`SELECT id,agreed_amount,currency,approval_status,approved_at,created_at FROM negotiation_agreements WHERE deal_id=$1`,[r.deal_id]).catch(()=>({rows:[]})),
   pool.query(`SELECT id,contract_number,status,amount,currency,sent_at,fully_signed_at,finalized_at,created_at FROM electronic_contracts WHERE deal_id=$1`,[r.deal_id]).catch(()=>({rows:[]})),
   pool.query(`SELECT id,status,final_amount,currency,invoice_id,closed_at,created_at FROM deal_closures WHERE deal_id=$1`,[r.deal_id]).catch(()=>({rows:[]})),
   pool.query(`SELECT id,event_type,payload,created_at FROM ai_deal_room_events WHERE room_id=$1 ORDER BY created_at DESC LIMIT 100`,[r.id]),
   pool.query(`SELECT * FROM ai_deal_room_documents WHERE room_id=$1 ORDER BY created_at DESC`,[r.id])]);
  const a=agreement.rows[0]||null,c=contract.rows[0]||null,cl=closure.rows[0]||null;
  const steps=[
   {key:'interest',label:'الاهتمام والعميل',done:!!r.lead_id,status:r.lead_stage||'pending'},
   {key:'viewing',label:'المعاينة',done:ap.rows.some(x=>x.status==='completed'),status:ap.rows[0]?.status||'pending'},
   {key:'negotiation',label:'التفاوض والعروض',done:offers.rows.length>0,status:a?.approval_status||(offers.rows[0]?.status||'pending')},
   {key:'agreement',label:'الاتفاق النهائي',done:!!a&&['approved','finalized'].includes(a.approval_status),status:a?.approval_status||'pending'},
   {key:'contract',label:'العقد والتوقيع',done:!!c&&c.status==='finalized',status:c?.status||'pending'},
   {key:'closing',label:'إغلاق الصفقة',done:!!cl&&cl.status==='completed',status:cl?.status||r.deal_status}
  ];
  return {steps,appointments:ap.rows,offers:offers.rows,agreement:a,contract:c,closure:cl,documents:docs.rows,events:events.rows};
 }
 app.post('/api/deal-room/deal/:dealId/open',async(req,res)=>{try{await ensure();const u=await user(req);if(!u)return res.status(401).json({error:'يجب تسجيل الدخول'});const d=(await pool.query(`SELECT d.*,p.owner_id FROM office_deals d LEFT JOIN properties p ON p.id=d.property_id WHERE d.id=$1`,[req.params.dealId])).rows[0];if(!d)return res.status(404).json({error:'الصفقة غير موجودة'});let allowed=u.role==='admin'||Number(d.owner_id)===Number(u.id);if(!allowed){const m=await pool.query(`SELECT 1 FROM office_members WHERE office_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,[d.office_id,u.id]).catch(()=>({rows:[]}));allowed=!!m.rows[0]}if(!allowed)return res.status(403).json({error:'غير مصرح'});
   const thread=(await pool.query(`SELECT id FROM ai_marketplace_threads WHERE property_id=$1 AND (lead_id=$2 OR office_id=$3) ORDER BY updated_at DESC LIMIT 1`,[d.property_id,d.lead_id,d.office_id]).catch(()=>({rows:[]}))).rows[0];
   const r=(await pool.query(`INSERT INTO ai_deal_rooms(deal_id,thread_id,office_id,property_id,lead_id,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(deal_id) DO UPDATE SET updated_at=NOW(),thread_id=COALESCE(ai_deal_rooms.thread_id,EXCLUDED.thread_id) RETURNING *`,[d.id,thread?.id||null,d.office_id,d.property_id,d.lead_id,u.id])).rows[0];
   await pool.query(`INSERT INTO ai_deal_room_events(room_id,actor_user_id,event_type,payload) VALUES($1,$2,'room_opened',$3)`,[r.id,u.id,{deal_id:d.id}]);res.status(201).json({room:r})}catch(e){console.error(e);res.status(500).json({error:'تعذر فتح غرفة الصفقة'})}});
 app.get('/api/deal-room/:id',async(req,res)=>{try{await ensure();const u=await user(req);if(!u)return res.status(401).json({error:'يجب تسجيل الدخول'});const r=await roomAccess(req.params.id,u);if(!r)return res.status(404).json({error:'غرفة الصفقة غير موجودة أو غير مصرح بها'});res.json({room:r,timeline:await buildTimeline(r),commission:{rate:Number(r.platform_commission_rate),amount:Number(r.platform_commission),payer:r.commission_payer},notice:'غرفة الصفقة تجمع الحالة فقط. قبول العرض والتوقيع وإغلاق الصفقة تبقى ضمن موافقات الأنظمة المختصة.'})}catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل غرفة الصفقة'})}});
 app.get('/api/deal-room',async(req,res)=>{try{await ensure();const u=await user(req);if(!u)return res.status(401).json({error:'يجب تسجيل الدخول'});let q;if(u.role==='admin')q=await pool.query(`SELECT r.*,d.amount,d.mode,d.status deal_status,p.title property_title FROM ai_deal_rooms r JOIN office_deals d ON d.id=r.deal_id LEFT JOIN properties p ON p.id=r.property_id ORDER BY r.updated_at DESC LIMIT 100`);else q=await pool.query(`SELECT DISTINCT r.*,d.amount,d.mode,d.status deal_status,p.title property_title FROM ai_deal_rooms r JOIN office_deals d ON d.id=r.deal_id LEFT JOIN properties p ON p.id=r.property_id LEFT JOIN office_members om ON om.office_id=r.office_id AND om.user_id=$1 AND om.status='active' LEFT JOIN ai_marketplace_threads t ON t.id=r.thread_id WHERE p.owner_id=$1 OR t.buyer_user_id=$1 OR t.seller_user_id=$1 OR om.user_id=$1 ORDER BY r.updated_at DESC LIMIT 100`,[u.id]);res.json({rooms:q.rows})}catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/deal-room/:id/document',async(req,res)=>{try{await ensure();const u=await user(req);if(!u)return res.status(401).json({error:'يجب تسجيل الدخول'});const r=await roomAccess(req.params.id,u);if(!r)return res.status(403).json({error:'غير مصرح'});const title=String(req.body?.title||'').trim(),type=String(req.body?.document_type||'other').trim();if(!title)return res.status(400).json({error:'عنوان المستند مطلوب'});const q=await pool.query(`INSERT INTO ai_deal_room_documents(room_id,document_type,title,url,external_entity_type,external_entity_id,added_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[r.id,type,title,req.body?.url||null,req.body?.external_entity_type||null,req.body?.external_entity_id||null,u.id]);await pool.query(`INSERT INTO ai_deal_room_events(room_id,actor_user_id,event_type,payload) VALUES($1,$2,'document_added',$3)`,[r.id,u.id,{document_id:q.rows[0].id,title}]);res.status(201).json({document:q.rows[0]})}catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/admin/deal-rooms',requireAdmin,async(req,res)=>{try{await ensure();const q=await pool.query(`SELECT r.*,d.amount,d.mode,d.status deal_status,d.platform_commission,p.title property_title,l.name lead_name FROM ai_deal_rooms r JOIN office_deals d ON d.id=r.deal_id LEFT JOIN properties p ON p.id=r.property_id LEFT JOIN office_leads l ON l.id=r.lead_id ORDER BY r.updated_at DESC LIMIT 200`);res.json({rooms:q.rows})}catch(e){res.status(500).json({error:e.message})}});
};
