module.exports=function installFraudTrustCenter(app,{pool,requireAdmin}){
 let ready=false;
 async function ensure(){if(ready)return;await pool.query(`
 CREATE TABLE IF NOT EXISTS ai_trust_assessments(
  id BIGSERIAL PRIMARY KEY, entity_type VARCHAR(30) NOT NULL, entity_id BIGINT NOT NULL,
  trust_score NUMERIC(5,2) NOT NULL DEFAULT 50, risk_level VARCHAR(20) NOT NULL DEFAULT 'medium',
  signals JSONB NOT NULL DEFAULT '[]'::jsonb, status VARCHAR(20) NOT NULL DEFAULT 'open',
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(entity_type,entity_id));
 CREATE TABLE IF NOT EXISTS ai_fraud_events(
  id BIGSERIAL PRIMARY KEY, entity_type VARCHAR(30) NOT NULL, entity_id BIGINT NOT NULL,
  event_type VARCHAR(60) NOT NULL, severity VARCHAR(20) NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ);
 CREATE INDEX IF NOT EXISTS idx_ai_trust_risk ON ai_trust_assessments(risk_level,trust_score);
 CREATE INDEX IF NOT EXISTS idx_ai_fraud_open ON ai_fraud_events(status,severity,created_at DESC);`);ready=true}
 const clamp=n=>Math.max(0,Math.min(100,Math.round(n)));
 async function scan(){await ensure();const props=(await pool.query(`SELECT p.*,u.email,u.phone owner_phone,o.verified office_verified,
  COALESCE(ai.duplicate_risk,0) duplicate_risk,ai.duplicate_property_id,COALESCE(ai.price_gap_pct,0) price_gap_pct,
  (SELECT COUNT(*) FROM property_images pi WHERE pi.property_id=p.id)::int image_count
  FROM properties p LEFT JOIN users u ON u.id=p.owner_id LEFT JOIN offices o ON o.id=p.office_id
  LEFT JOIN property_ai_scores ai ON ai.property_id=p.id WHERE p.status IN ('pending','active') ORDER BY p.created_at DESC LIMIT 2000`)).rows;
 let assessed=0,high=0;
 for(const p of props){let score=100;const signals=[];const add=(points,code,label)=>{score-=points;signals.push({code,label,points})};
  if(+p.duplicate_risk>=70)add(35,'duplicate','احتمال مرتفع لتكرار العقار'); else if(+p.duplicate_risk>=40)add(15,'duplicate','احتمال متوسط لتكرار العقار');
  if(Math.abs(+p.price_gap_pct)>=60)add(25,'price_outlier','السعر بعيد جداً عن التقييم المقارن'); else if(Math.abs(+p.price_gap_pct)>=35)add(12,'price_outlier','السعر شاذ نسبياً عن السوق');
  if(!p.latitude||!p.longitude)add(8,'missing_geo','الموقع الجغرافي غير مكتمل');
  if(+p.image_count===0)add(15,'no_images','لا توجد صور للعقار');
  if(!p.description||String(p.description).trim().length<40)add(8,'thin_description','الوصف غير كافٍ');
  if(!p.email&&!p.owner_phone)add(12,'owner_contact','بيانات تواصل المالك غير مكتملة');
  if(p.office_id&&!p.office_verified)add(8,'office_unverified','المكتب غير موثق');
  score=clamp(score);const risk=score<40?'critical':score<60?'high':score<80?'medium':'low'; if(['critical','high'].includes(risk))high++;
  await pool.query(`INSERT INTO ai_trust_assessments(entity_type,entity_id,trust_score,risk_level,signals,assessed_at) VALUES('property',$1,$2,$3,$4,NOW()) ON CONFLICT(entity_type,entity_id) DO UPDATE SET trust_score=EXCLUDED.trust_score,risk_level=EXCLUDED.risk_level,signals=EXCLUDED.signals,assessed_at=NOW()`,[p.id,score,risk,JSON.stringify(signals)]);assessed++;
 }
 const users=(await pool.query(`SELECT u.id,u.is_active,u.created_at,COUNT(p.id)::int properties_count,COUNT(p.id) FILTER(WHERE p.status='rejected')::int rejected_count FROM users u LEFT JOIN properties p ON p.owner_id=u.id GROUP BY u.id ORDER BY u.created_at DESC LIMIT 2000`)).rows;
 for(const u of users){let score=100,signals=[];if(+u.properties_count>=20){score-=10;signals.push({code:'high_volume',label:'حجم نشر مرتفع',points:10})}if(+u.rejected_count>=3){score-=25;signals.push({code:'rejections',label:'عدة عقارات مرفوضة',points:25})}if(!u.is_active){score-=40;signals.push({code:'inactive',label:'الحساب غير نشط',points:40})}const risk=score<40?'critical':score<60?'high':score<80?'medium':'low';await pool.query(`INSERT INTO ai_trust_assessments(entity_type,entity_id,trust_score,risk_level,signals,assessed_at) VALUES('user',$1,$2,$3,$4,NOW()) ON CONFLICT(entity_type,entity_id) DO UPDATE SET trust_score=EXCLUDED.trust_score,risk_level=EXCLUDED.risk_level,signals=EXCLUDED.signals,assessed_at=NOW()`,[u.id,score,risk,JSON.stringify(signals)])}
 return {properties_assessed:assessed,high_risk_properties:high,users_assessed:users.length};}
 app.post('/api/admin/trust/scan',requireAdmin,async(_q,res)=>{try{res.json(await scan())}catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/admin/trust',requireAdmin,async(req,res)=>{try{await ensure();const risk=String(req.query.risk||'');const vals=[];let where=`WHERE a.entity_type='property'`;if(risk){vals.push(risk);where+=` AND a.risk_level=$${vals.length}`};const rows=(await pool.query(`SELECT a.*,p.title,p.city,p.district,p.price,p.mode,p.status property_status FROM ai_trust_assessments a JOIN properties p ON p.id=a.entity_id ${where} ORDER BY CASE a.risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,a.trust_score ASC LIMIT 300`,vals)).rows;const summary=(await pool.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE risk_level='critical')::int critical,COUNT(*) FILTER(WHERE risk_level='high')::int high,ROUND(AVG(trust_score),1) avg_score FROM ai_trust_assessments WHERE entity_type='property'`)).rows[0];res.json({summary,items:rows,safety:{auto_reject:false,auto_suspend:false,review_required:true}})}catch(e){res.status(500).json({error:e.message})}});
 app.patch('/api/admin/trust/:id/status',requireAdmin,async(req,res)=>{try{await ensure();const status=['open','reviewed','cleared'].includes(req.body.status)?req.body.status:null;if(!status)return res.status(400).json({error:'invalid status'});const row=(await pool.query(`UPDATE ai_trust_assessments SET status=$1 WHERE id=$2 RETURNING *`,[status,req.params.id])).rows[0];res.json(row||{})}catch(e){res.status(500).json({error:e.message})}});
 // Concurrent startup DDL can abort this idempotent scan with a PostgreSQL deadlock.
 // Retry the full scan only for that transient condition; keep every check enabled.
 const startup=(async()=>{for(let attempt=0;attempt<3;attempt++){
  try{return await scan();}catch(error){if(error.code!=='40P01'||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));}
 }})().catch(console.error);
 return{scan,startup};
};
