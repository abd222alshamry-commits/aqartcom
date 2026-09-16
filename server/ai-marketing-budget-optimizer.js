const crypto=require('crypto');
module.exports=function(app,{pool,requireAdmin}){
 const CONFIRM='أوافق على تعديل الميزانية';
 const safe=async(q,p=[])=>{try{return (await pool.query(q,p)).rows}catch{return []}};
 const n=v=>Number(v||0)||0;
 async function schema(){await pool.query(`
 CREATE TABLE IF NOT EXISTS ai_marketing_budget_plans(
   id UUID PRIMARY KEY, window_days INT NOT NULL DEFAULT 30, currency TEXT NOT NULL,
   current_total_budget NUMERIC(18,2) DEFAULT 0, proposed_total_budget NUMERIC(18,2) DEFAULT 0,
   strategy TEXT DEFAULT 'profit_weighted', summary JSONB DEFAULT '{}'::jsonb,
   status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','applied','dismissed')),
   created_by BIGINT, created_at TIMESTAMPTZ DEFAULT NOW(), approved_by BIGINT, approved_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS ai_marketing_budget_recommendations(
   id UUID PRIMARY KEY, plan_id UUID NOT NULL REFERENCES ai_marketing_budget_plans(id) ON DELETE CASCADE,
   platform TEXT NOT NULL, external_campaign_id TEXT NOT NULL, campaign_name TEXT,
   currency TEXT NOT NULL, current_daily_budget NUMERIC(18,2), proposed_daily_budget NUMERIC(18,2),
   change_percent NUMERIC(10,2), score NUMERIC(10,4), reason TEXT, evidence JSONB DEFAULT '{}'::jsonb,
   status TEXT DEFAULT 'proposed' CHECK(status IN ('proposed','approved','executed','failed','dismissed')),
   execution_error TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_budget_plan_created ON ai_marketing_budget_plans(created_at DESC);
 `)} schema().catch(e=>console.error('V77 schema',e.message));
 async function build(days,actor){
  days=Math.min(90,Math.max(7,Number(days)||30));
  const rows=await safe(`SELECT c.platform,c.external_campaign_id,c.name,c.currency,c.daily_budget,c.status,
   COALESCE(SUM(m.spend),0) spend,COALESCE(SUM(m.conversions),0) conversions,COALESCE(SUM(m.conversion_value),0) conversion_value
   FROM ad_platform_campaigns c LEFT JOIN ad_platform_daily_metrics m ON m.platform=c.platform AND m.external_campaign_id=c.external_campaign_id AND m.metric_date>=CURRENT_DATE-$1::int
   GROUP BY c.platform,c.external_campaign_id,c.name,c.currency,c.daily_budget,c.status`,[days]);
  const currencies=[...new Set(rows.map(x=>x.currency||'USD'))], plans=[];
  for(const currency of currencies){const set=rows.filter(x=>(x.currency||'USD')===currency && String(x.status||'').toLowerCase()!=='removed');if(!set.length)continue;
   const total=set.reduce((s,x)=>s+n(x.daily_budget),0); const scored=set.map(x=>{const spend=n(x.spend),val=n(x.conversion_value),conv=n(x.conversions),roas=spend?val/spend:0;let score=Math.max(0,Math.min(10,roas));if(conv===0&&spend>0)score*=0.2;if(spend===0)score=Math.max(score,0.5);return {...x,roas,score}});
   const sumScore=scored.reduce((s,x)=>s+x.score,0)||scored.length;const planId=crypto.randomUUID();
   await pool.query(`INSERT INTO ai_marketing_budget_plans(id,window_days,currency,current_total_budget,proposed_total_budget,summary,created_by) VALUES($1,$2,$3,$4,$4,$5,$6)`,[planId,days,currency,total,JSON.stringify({campaigns:scored.length,method:'ROAS/conversion weighted; total budget preserved; max movement ±25% per plan'}),actor||null]);
   for(const x of scored){const cur=n(x.daily_budget);const ideal=total*(sumScore?x.score/sumScore:1/scored.length);const low=cur*0.75,high=cur*1.25;const proposed=cur?Math.max(low,Math.min(high,ideal)):Math.max(0,ideal);const pct=cur?(proposed-cur)/cur*100:null;const reason=x.roas>=3?'أداء قوي؛ اقتراح زيادة تدريجية.':x.roas<0.8&&n(x.spend)>0?'عائد ضعيف؛ اقتراح خفض تدريجي.':'إعادة موازنة محافظة حسب الأداء الفعلي.';
    await pool.query(`INSERT INTO ai_marketing_budget_recommendations(id,plan_id,platform,external_campaign_id,campaign_name,currency,current_daily_budget,proposed_daily_budget,change_percent,score,reason,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[crypto.randomUUID(),planId,x.platform,x.external_campaign_id,x.name,currency,cur,proposed,pct,x.score,reason,JSON.stringify({days,spend:n(x.spend),conversions:n(x.conversions),conversion_value:n(x.conversion_value),roas:x.roas})]);}
   plans.push(planId);
  } return plans;
 }
 app.post('/api/admin/marketing-budget-optimizer/generate',requireAdmin,async(req,res)=>{try{const ids=await build(req.body?.days,req.user.id);res.json({ok:true,plan_ids:ids,confirmation_phrase:CONFIRM})}catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/admin/marketing-budget-optimizer',requireAdmin,async(req,res)=>{try{const plans=await safe(`SELECT * FROM ai_marketing_budget_plans ORDER BY created_at DESC LIMIT 20`);const recs=plans[0]?await safe(`SELECT * FROM ai_marketing_budget_recommendations WHERE plan_id=$1 ORDER BY score DESC`,[plans[0].id]):[];res.json({plans,recommendations:recs,confirmation_phrase:CONFIRM,note:'العملات منفصلة. لا يتم تعديل أي ميزانية خارجية دون موافقة صريحة، والاقتراح يحافظ على إجمالي الميزانية داخل كل عملة.'})}catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/admin/marketing-budget-optimizer/plans/:id/approve',requireAdmin,async(req,res)=>{try{if(req.body?.confirmation!==CONFIRM)return res.status(400).json({error:`اكتب حرفياً: ${CONFIRM}`});const r=await pool.query(`UPDATE ai_marketing_budget_plans SET status='approved',approved_by=$2,approved_at=NOW() WHERE id=$1 AND status='draft' RETURNING *`,[req.params.id,req.user.id]);if(!r.rows[0])return res.status(409).json({error:'الخطة غير متاحة للاعتماد'});await pool.query(`UPDATE ai_marketing_budget_recommendations SET status='approved' WHERE plan_id=$1 AND status='proposed'`,[req.params.id]);res.json({ok:true,plan:r.rows[0],message:'تم اعتماد الخطة داخلياً. التنفيذ الخارجي يبقى عبر موصلات المنصات ومسارات الموافقة المحمية.'})}catch(e){res.status(500).json({error:e.message})}});
};
