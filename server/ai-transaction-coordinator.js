'use strict';

module.exports=function installAITransactionCoordinator(app,{pool,getCurrentUser}){
 const COMPLETE_PHRASE='أؤكد إتمام المهمة';
 const escStatus=s=>['pending','in_progress','completed','blocked','cancelled'].includes(s)?s:'pending';

 async function ensure(){await pool.query(`
  CREATE TABLE IF NOT EXISTS ai_transaction_coordinators(
   id BIGSERIAL PRIMARY KEY,room_id BIGINT NOT NULL UNIQUE REFERENCES ai_deal_rooms(id) ON DELETE CASCADE,
   status VARCHAR(30) NOT NULL DEFAULT 'active',risk_score INTEGER NOT NULL DEFAULT 0,
   summary TEXT,next_action TEXT,last_reviewed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS ai_transaction_tasks(
   id BIGSERIAL PRIMARY KEY,coordinator_id BIGINT NOT NULL REFERENCES ai_transaction_coordinators(id) ON DELETE CASCADE,
   task_key VARCHAR(80) NOT NULL,category VARCHAR(40) NOT NULL,title VARCHAR(220) NOT NULL,description TEXT,
   due_at TIMESTAMPTZ,priority VARCHAR(20) NOT NULL DEFAULT 'medium',status VARCHAR(30) NOT NULL DEFAULT 'pending',
   requires_approval BOOLEAN NOT NULL DEFAULT FALSE,assigned_role VARCHAR(50),completed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
   completed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   UNIQUE(coordinator_id,task_key));
  CREATE TABLE IF NOT EXISTS ai_transaction_coordinator_events(
   id BIGSERIAL PRIMARY KEY,coordinator_id BIGINT NOT NULL REFERENCES ai_transaction_coordinators(id) ON DELETE CASCADE,
   actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,event_type VARCHAR(60) NOT NULL,payload JSONB NOT NULL DEFAULT '{}'::jsonb,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS idx_transaction_tasks_status ON ai_transaction_tasks(coordinator_id,status,due_at);
 `)}

 async function access(roomId,u){
  const q=await pool.query(`SELECT r.*,d.mode,d.amount,d.status deal_status,d.platform_commission,p.title property_title,p.city,p.district,p.owner_id,
   l.name lead_name,t.buyer_user_id,t.seller_user_id FROM ai_deal_rooms r JOIN office_deals d ON d.id=r.deal_id
   LEFT JOIN properties p ON p.id=r.property_id LEFT JOIN office_leads l ON l.id=r.lead_id LEFT JOIN ai_marketplace_threads t ON t.id=r.thread_id WHERE r.id=$1`,[roomId]);
  const r=q.rows[0];if(!r)return null;if(u?.role==='admin')return r;
  const m=await pool.query(`SELECT 1 FROM office_members WHERE office_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,[r.office_id,u?.id||0]).catch(()=>({rows:[]}));
  return Number(r.owner_id)===Number(u?.id)||Number(r.buyer_user_id)===Number(u?.id)||Number(r.seller_user_id)===Number(u?.id)||m.rows[0]?r:null;
 }

 async function facts(r){
  const [appointments,offers,agreement,contract,closure,documents]=await Promise.all([
   pool.query(`SELECT id,status,starts_at,ends_at FROM office_appointments WHERE property_id=$1 AND ($2::bigint IS NULL OR lead_id=$2) ORDER BY starts_at DESC LIMIT 10`,[r.property_id,r.lead_id]),
   pool.query(`SELECT id,status,created_at FROM negotiation_offers WHERE deal_id=$1 ORDER BY created_at DESC`,[r.deal_id]).catch(()=>({rows:[]})),
   pool.query(`SELECT id,approval_status,created_at FROM negotiation_agreements WHERE deal_id=$1 ORDER BY id DESC LIMIT 1`,[r.deal_id]).catch(()=>({rows:[]})),
   pool.query(`SELECT id,status,sent_at,fully_signed_at,finalized_at FROM electronic_contracts WHERE deal_id=$1 ORDER BY id DESC LIMIT 1`,[r.deal_id]).catch(()=>({rows:[]})),
   pool.query(`SELECT id,status,closed_at FROM deal_closures WHERE deal_id=$1 ORDER BY id DESC LIMIT 1`,[r.deal_id]).catch(()=>({rows:[]})),
   pool.query(`SELECT id,document_type,title,status FROM ai_deal_room_documents WHERE room_id=$1`,[r.id])]);
  return {appointments:appointments.rows,offers:offers.rows,agreement:agreement.rows[0],contract:contract.rows[0],closure:closure.rows[0],documents:documents.rows};
 }

 function plan(r,f){
  const now=Date.now(),day=86400000,hasViewing=f.appointments.some(x=>x.status==='completed'),hasOffer=f.offers.length>0;
  const agreed=!!f.agreement&&['approved','finalized'].includes(f.agreement.approval_status),signed=!!f.contract&&f.contract.status==='finalized',closed=!!f.closure&&f.closure.status==='completed';
  const docs=new Set(f.documents.map(x=>x.document_type));
  const tasks=[
   ['verify_parties','verification','التحقق من بيانات أطراف الصفقة','تأكيد بيانات المشتري والبائع ووسائل التواصل.',1,'high',false,'office'],
   ['ownership_document','documents','إرفاق مستند إثبات الملكية','يجب أن يكون المستند متاحًا للمراجعة قبل التعاقد.',2,'high',false,'seller'],
   ['viewing','viewing','إتمام معاينة العقار','تنسيق الموعد وتوثيق نتيجة المعاينة.',3,'high',false,'office'],
   ['offer','negotiation','توثيق عرض السعر','إرسال العرض عبر مسار التفاوض المعتمد.',4,'high',true,'buyer'],
   ['agreement','agreement','اعتماد الاتفاق النهائي','يتطلب موافقة صريحة من الأطراف المخولة.',6,'high',true,'parties'],
   ['contract','contract','إعداد العقد وإرساله للتوقيع','مراجعة العقد ثم توقيعه عبر نظام العقود.',8,'high',true,'office'],
   ['commission','finance','مراجعة العمولة والجهة الدافعة','مطابقة عمولة المنصة مع بيانات الصفقة الحالية.',9,'medium',false,'office'],
   ['closing','closing','إغلاق الصفقة وتوثيق التسليم','لا يتم الإغلاق إلا عبر موافقة مسار الإغلاق.',10,'high',true,'office']
  ].map(x=>({key:x[0],category:x[1],title:x[2],description:x[3],due:new Date(now+x[4]*day),priority:x[5],approval:x[6],role:x[7]}));
  const complete={verify_parties:!!r.lead_id,ownership_document:docs.has('ownership')||docs.has('ownership_verification'),viewing:hasViewing,offer:hasOffer,agreement:agreed,contract:signed,commission:Number(r.platform_commission)>=0,closing:closed};
  return {tasks,complete,done:Object.values(complete).filter(Boolean).length,total:tasks.length};
 }

 async function sync(r,u){
  const f=await facts(r),p=plan(r,f);
  let risk=0;if(!r.lead_id)risk+=20;if(!p.complete.ownership_document)risk+=25;if(!p.complete.viewing)risk+=15;if(p.complete.offer&&!p.complete.agreement)risk+=15;if(p.complete.agreement&&!p.complete.contract)risk+=15;if(p.complete.contract&&!p.complete.closing)risk+=10;
  const next=p.tasks.find(x=>!p.complete[x.key]);
  const summary=`اكتملت ${p.done} من ${p.total} مراحل تنسيق الصفقة. مستوى المخاطر ${risk<25?'منخفض':risk<55?'متوسط':'مرتفع'}.`;
  const c=(await pool.query(`INSERT INTO ai_transaction_coordinators(room_id,risk_score,summary,next_action,last_reviewed_at) VALUES($1,$2,$3,$4,NOW())
   ON CONFLICT(room_id) DO UPDATE SET risk_score=EXCLUDED.risk_score,summary=EXCLUDED.summary,next_action=EXCLUDED.next_action,last_reviewed_at=NOW(),updated_at=NOW() RETURNING *`,[r.id,risk,summary,next?.title||'جميع مراحل التنسيق مكتملة'])).rows[0];
  for(const t of p.tasks){await pool.query(`INSERT INTO ai_transaction_tasks(coordinator_id,task_key,category,title,description,due_at,priority,status,requires_approval,assigned_role)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(coordinator_id,task_key) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,requires_approval=EXCLUDED.requires_approval,assigned_role=EXCLUDED.assigned_role,
   status=CASE WHEN ai_transaction_tasks.status='completed' OR $11 THEN 'completed' ELSE ai_transaction_tasks.status END,completed_at=CASE WHEN $11 THEN COALESCE(ai_transaction_tasks.completed_at,NOW()) ELSE ai_transaction_tasks.completed_at END,updated_at=NOW()`,[c.id,t.key,t.category,t.title,t.description,t.due,t.priority,p.complete[t.key]?'completed':'pending',t.approval,t.role,p.complete[t.key]]);}
  await pool.query(`INSERT INTO ai_transaction_coordinator_events(coordinator_id,actor_user_id,event_type,payload) VALUES($1,$2,'plan_refreshed',$3)`,[c.id,u.id,{risk_score:risk,completed:p.done,total:p.total}]);return c;
 }

 async function response(roomId,u,refresh=false){const r=await access(roomId,u);if(!r)return null;let c=(await pool.query(`SELECT * FROM ai_transaction_coordinators WHERE room_id=$1`,[r.id])).rows[0];if(!c||refresh)c=await sync(r,u);const [tasks,events]=await Promise.all([pool.query(`SELECT *,(status<>'completed' AND due_at<NOW()) overdue FROM ai_transaction_tasks WHERE coordinator_id=$1 ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,due_at`,[c.id]),pool.query(`SELECT event_type,payload,created_at FROM ai_transaction_coordinator_events WHERE coordinator_id=$1 ORDER BY created_at DESC LIMIT 30`,[c.id])]);return {room:r,coordinator:c,tasks:tasks.rows,events:events.rows,guardrails:{automatic_legal_actions:false,completion_phrase:COMPLETE_PHRASE,notice:'المنسّق يقترح ويراقب فقط. قبول العرض والتوقيع وإغلاق الصفقة تتطلب موافقة صريحة عبر أنظمتها المختصة.'}}}

 app.get('/api/transaction-coordinator/room/:roomId',async(req,res)=>{try{await ensure();const u=await getCurrentUser(req);if(!u)return res.status(401).json({error:'يجب تسجيل الدخول'});const d=await response(req.params.roomId,u);if(!d)return res.status(404).json({error:'غرفة الصفقة غير موجودة أو غير مصرح بها'});res.json(d)}catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل منسّق المعاملة'})}});
 app.post('/api/transaction-coordinator/room/:roomId/refresh',async(req,res)=>{try{await ensure();const u=await getCurrentUser(req);if(!u)return res.status(401).json({error:'يجب تسجيل الدخول'});const d=await response(req.params.roomId,u,true);if(!d)return res.status(404).json({error:'غير مصرح'});res.json(d)}catch(e){console.error(e);res.status(500).json({error:'تعذر تحديث خطة المعاملة'})}});
 app.post('/api/transaction-coordinator/task/:taskId/status',async(req,res)=>{try{await ensure();const u=await getCurrentUser(req);if(!u)return res.status(401).json({error:'يجب تسجيل الدخول'});const q=await pool.query(`SELECT t.*,c.room_id FROM ai_transaction_tasks t JOIN ai_transaction_coordinators c ON c.id=t.coordinator_id WHERE t.id=$1`,[req.params.taskId]);const t=q.rows[0];if(!t||!await access(t.room_id,u))return res.status(404).json({error:'المهمة غير موجودة أو غير مصرح بها'});const status=escStatus(req.body?.status);if(status==='completed'&&req.body?.confirmation!==COMPLETE_PHRASE)return res.status(400).json({error:`لإتمام المهمة اكتب: ${COMPLETE_PHRASE}`});const updated=(await pool.query(`UPDATE ai_transaction_tasks SET status=$1,completed_by=CASE WHEN $1='completed' THEN $2 ELSE NULL END,completed_at=CASE WHEN $1='completed' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$3 RETURNING *`,[status,u.id,t.id])).rows[0];await pool.query(`INSERT INTO ai_transaction_coordinator_events(coordinator_id,actor_user_id,event_type,payload) VALUES($1,$2,'task_status_changed',$3)`,[t.coordinator_id,u.id,{task_id:t.id,status}]);res.json({task:updated})}catch(e){res.status(500).json({error:e.message})}});
};
