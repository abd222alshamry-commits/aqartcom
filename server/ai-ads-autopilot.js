const crypto=require('crypto');
module.exports=function(app,{pool,requireAdmin}){
 const uuid=()=>crypto.randomUUID();
 const num=v=>Number(v||0)||0;
 const CONFIRM='أوافق على تعديل الحملة';
 async function schema(){await pool.query(`
 CREATE TABLE IF NOT EXISTS ai_ads_autopilot_proposals(
   id UUID PRIMARY KEY, platform TEXT NOT NULL, external_campaign_id TEXT NOT NULL, campaign_name TEXT,
   action_type TEXT NOT NULL CHECK(action_type IN ('pause_campaign','enable_campaign','change_budget','review_campaign')),
   current_value JSONB DEFAULT '{}'::jsonb, proposed_value JSONB DEFAULT '{}'::jsonb,
   reason TEXT NOT NULL, evidence JSONB DEFAULT '{}'::jsonb, priority TEXT DEFAULT 'medium',
   status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','executed','dismissed','failed')),
   created_at TIMESTAMPTZ DEFAULT NOW(), approved_at TIMESTAMPTZ, approved_by BIGINT,
   executed_at TIMESTAMPTZ, execution_error TEXT, execution_response JSONB DEFAULT '{}'::jsonb,
   UNIQUE(platform,external_campaign_id,action_type,status)
 );
 CREATE TABLE IF NOT EXISTS ai_ads_autopilot_audit(
   id BIGSERIAL PRIMARY KEY, proposal_id UUID, actor_id BIGINT, event TEXT NOT NULL,
   before_state JSONB DEFAULT '{}'::jsonb, after_state JSONB DEFAULT '{}'::jsonb,
   created_at TIMESTAMPTZ DEFAULT NOW()
 );
 CREATE INDEX IF NOT EXISTS idx_ai_ads_proposals_status ON ai_ads_autopilot_proposals(status,created_at DESC);
 `)} schema().catch(e=>console.error('V63 schema',e.message));
 async function audit(pid,actor,event,before,after){await pool.query(`INSERT INTO ai_ads_autopilot_audit(proposal_id,actor_id,event,before_state,after_state) VALUES($1,$2,$3,$4,$5)`,[pid,actor||null,event,JSON.stringify(before||{}),JSON.stringify(after||{})])}
 async function propose(x,action,reason,priority,proposed,evidence){
   const exists=await pool.query(`SELECT id FROM ai_ads_autopilot_proposals WHERE platform=$1 AND external_campaign_id=$2 AND action_type=$3 AND status='proposed' LIMIT 1`,[x.platform,x.external_campaign_id,action]);
   if(exists.rows[0])return false;
   const id=uuid(); await pool.query(`INSERT INTO ai_ads_autopilot_proposals(id,platform,external_campaign_id,campaign_name,action_type,current_value,proposed_value,reason,evidence,priority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,x.platform,x.external_campaign_id,x.name,action,JSON.stringify({status:x.status,spend:num(x.spend),conversions:num(x.conversions),conversion_value:num(x.conversion_value)}),JSON.stringify(proposed||{}),reason,JSON.stringify(evidence||{}),priority]);return true;
 }
 async function scan(){
   const r=await pool.query(`SELECT c.platform,c.external_campaign_id,c.name,c.status,COALESCE(SUM(m.spend),0) spend,COALESCE(SUM(m.clicks),0) clicks,COALESCE(SUM(m.conversions),0) conversions,COALESCE(SUM(m.conversion_value),0) conversion_value FROM ad_platform_campaigns c LEFT JOIN ad_platform_daily_metrics m ON m.platform=c.platform AND m.external_campaign_id=c.external_campaign_id AND m.metric_date>=CURRENT_DATE-14 GROUP BY c.platform,c.external_campaign_id,c.name,c.status`);
   let created=0; const minSpend=num(process.env.AI_ADS_MIN_SPEND||100), badRoas=num(process.env.AI_ADS_BAD_ROAS||0.8), goodRoas=num(process.env.AI_ADS_GOOD_ROAS||3);
   for(const x of r.rows){const spend=num(x.spend),conv=num(x.conversions),value=num(x.conversion_value),roas=spend?value/spend:0,cpa=conv?spend/conv:null;
     const evidence={window_days:14,spend,clicks:num(x.clicks),conversions:conv,conversion_value:value,roas,cpa};
     if(spend>=minSpend&&conv===0){if(await propose(x,'pause_campaign',`إنفاق ${spend.toFixed(2)} دون تحويلات خلال 14 يوماً.`,'high',{status:'PAUSED'},evidence))created++;}
     else if(spend>=minSpend&&value>0&&roas<badRoas){if(await propose(x,'pause_campaign',`ROAS منخفض (${roas.toFixed(2)}x) خلال 14 يوماً.`,'high',{status:'PAUSED'},evidence))created++;}
     else if(spend>=minSpend&&roas>=goodRoas){if(await propose(x,'review_campaign',`الحملة رابحة (ROAS ${roas.toFixed(2)}x). راجع رفع الميزانية تدريجياً.`,'medium',{suggested_budget_change_percent:15},evidence))created++;}
   }
   return {created,scanned:r.rowCount,thresholds:{min_spend:minSpend,bad_roas:badRoas,good_roas:goodRoas}};
 }
 function googleCreds(){return {token:process.env.GOOGLE_ADS_ACCESS_TOKEN,customer:String(process.env.GOOGLE_ADS_CUSTOMER_ID||'').replace(/-/g,''),login:String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID||'').replace(/-/g,''),developer:process.env.GOOGLE_ADS_DEVELOPER_TOKEN,version:process.env.GOOGLE_ADS_API_VERSION||'v25'}}
 async function googleHeaders(){const c=googleCreds();if(!c.token||!c.customer||!c.developer)throw Error('بيانات Google Ads غير مكتملة');const h={'Content-Type':'application/json','Authorization':`Bearer ${c.token}`,'developer-token':c.developer};if(c.login)h['login-customer-id']=c.login;return {c,h}}
 async function googleCampaignStatus(campaignId,status){const {c,h}=await googleHeaders();const body={operations:[{update:{resourceName:`customers/${c.customer}/campaigns/${campaignId}`,status},updateMask:'status'}]};const r=await fetch(`https://googleads.googleapis.com/${c.version}/customers/${c.customer}/campaigns:mutate`,{method:'POST',headers:h,body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j?.error?.message||`Google Ads HTTP ${r.status}`);return j}
 async function execute(p){
   if(p.action_type==='review_campaign')throw Error('هذه توصية مراجعة فقط؛ أنشئ اقتراح ميزانية محدداً بعد تحديد الميزانية الحالية.');
   if(p.platform==='google'&&(p.action_type==='pause_campaign'||p.action_type==='enable_campaign'))return googleCampaignStatus(p.external_campaign_id,p.action_type==='pause_campaign'?'PAUSED':'ENABLED');
   // V63 intentionally blocks unverified mutation adapters. Data sync/analysis remains available for all platforms.
   throw Error(`التنفيذ الخارجي المباشر لـ ${p.platform} غير مفعّل في V63 حتى يتم إعداد صلاحيات/واجهة التعديل المعتمدة للحساب. الاقتراح محفوظ للمراجعة.`);
 }
 app.post('/api/admin/ads-autopilot/scan',requireAdmin,async(req,res)=>{try{const out=await scan();await audit(null,req.user.id,'scan',{},out);res.json({ok:true,...out})}catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/admin/ads-autopilot',requireAdmin,async(req,res)=>{try{const status=req.query.status||'proposed';const [p,a]=await Promise.all([pool.query(`SELECT * FROM ai_ads_autopilot_proposals WHERE ($1='all' OR status=$1) ORDER BY CASE priority WHEN 'high' THEN 1 ELSE 2 END,created_at DESC LIMIT 200`,[status]),pool.query(`SELECT * FROM ai_ads_autopilot_audit ORDER BY created_at DESC LIMIT 100`)]);res.json({confirmation_phrase:CONFIRM,proposals:p.rows,audit:a.rows})}catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/admin/ads-autopilot/proposals/:id/execute',requireAdmin,async(req,res)=>{try{
   if(req.body?.confirmation!==CONFIRM)return res.status(400).json({error:`للتنفيذ اكتب حرفياً: ${CONFIRM}`});
   const q=await pool.query(`SELECT * FROM ai_ads_autopilot_proposals WHERE id=$1 FOR UPDATE`,[req.params.id]);const p=q.rows[0];if(!p)return res.status(404).json({error:'الاقتراح غير موجود'});if(p.status==='executed')return res.json({ok:true,already_executed:true});if(!['proposed','approved','failed'].includes(p.status))return res.status(409).json({error:'حالة الاقتراح لا تسمح بالتنفيذ'});
   await pool.query(`UPDATE ai_ads_autopilot_proposals SET status='approved',approved_at=NOW(),approved_by=$2,execution_error=NULL WHERE id=$1`,[p.id,req.user.id]);await audit(p.id,req.user.id,'approved',p,{status:'approved'});
   try{const out=await execute(p);await pool.query(`UPDATE ai_ads_autopilot_proposals SET status='executed',executed_at=NOW(),execution_response=$2 WHERE id=$1`,[p.id,JSON.stringify(out||{})]);await audit(p.id,req.user.id,'executed',{status:'approved'},{status:'executed',response:out});res.json({ok:true,result:out});}
   catch(e){await pool.query(`UPDATE ai_ads_autopilot_proposals SET status='failed',execution_error=$2 WHERE id=$1`,[p.id,e.message]);await audit(p.id,req.user.id,'failed',{status:'approved'},{status:'failed',error:e.message});res.status(502).json({error:e.message})}
 }catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/admin/ads-autopilot/proposals/:id/dismiss',requireAdmin,async(req,res)=>{try{const r=await pool.query(`UPDATE ai_ads_autopilot_proposals SET status='dismissed' WHERE id=$1 AND status='proposed' RETURNING *`,[req.params.id]);if(!r.rows[0])return res.status(404).json({error:'الاقتراح غير متاح'});await audit(req.params.id,req.user.id,'dismissed',{},r.rows[0]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
};
