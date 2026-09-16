module.exports=function installBusinessAutopilot(app,{pool,requireAdmin}){
 const minutes=Math.max(15,Number(process.env.AI_BUSINESS_AUTOPILOT_MINUTES||60)); let ready=false,running=false;
 async function ensure(){if(ready)return;await pool.query(`CREATE TABLE IF NOT EXISTS ai_business_autopilot_runs(id BIGSERIAL PRIMARY KEY,status VARCHAR(20) NOT NULL DEFAULT 'completed',snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,findings JSONB NOT NULL DEFAULT '[]'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE INDEX IF NOT EXISTS idx_ai_business_autopilot_runs ON ai_business_autopilot_runs(created_at DESC)`);ready=true}
 async function one(sql){try{return (await pool.query(sql)).rows[0]||{}}catch{return{}}}
 async function cycle(){if(running)return null;running=true;try{await ensure();const [leads,invoices,props,deals,ads,ai]=await Promise.all([
 one(`SELECT COUNT(*) FILTER(WHERE stage NOT IN ('won','lost') AND next_follow_up<NOW())::int overdue,COUNT(*) FILTER(WHERE stage IN ('interested','viewing','negotiation'))::int hot FROM office_leads`),
 one(`SELECT COUNT(*) FILTER(WHERE status NOT IN ('paid','void') AND due_date<CURRENT_DATE)::int overdue,COALESCE(SUM(total_amount-paid_amount) FILTER(WHERE status NOT IN ('paid','void') AND due_date<CURRENT_DATE),0) balance FROM electronic_invoices`),
 one(`SELECT COUNT(*) FILTER(WHERE status='pending')::int pending,COUNT(*) FILTER(WHERE status='active')::int active FROM properties`),
 one(`SELECT COUNT(*) FILTER(WHERE status IN ('negotiation','reserved'))::int open,COUNT(*) FILTER(WHERE status='completed' AND updated_at>=NOW()-INTERVAL '24 hours')::int completed24 FROM office_deals`),
 one(`SELECT COALESCE(SUM(spend),0) spend,COALESCE(SUM(conversions),0) conversions,COALESCE(SUM(conversion_value),0) value FROM ad_platform_daily_metrics WHERE metric_date>=CURRENT_DATE-7`),
 one(`SELECT COUNT(*) FILTER(WHERE status='proposed')::int pending,COUNT(*) FILTER(WHERE status='proposed' AND priority IN ('high','critical'))::int high FROM ai_executive_proposals`)]);
 const snapshot={leads,invoices,properties:props,deals,ads,executive:ai,generated_at:new Date().toISOString()},findings=[];
 const add=(priority,area,title,recommendation,requires_approval=false)=>findings.push({priority,area,title,recommendation,requires_approval});
 if(+leads.overdue)add('high','sales',`${leads.overdue} متابعة عميل متأخرة`,'تشغيل فحص المدير التنفيذي وإنشاء مقترحات متابعة.');
 if(+invoices.overdue)add('high','finance',`${invoices.overdue} فاتورة متأخرة`,'مراجعة التحصيل؛ لا يتم تسجيل دفعة أو تحويل أموال تلقائياً.',true);
 if(+props.pending)add('medium','properties',`${props.pending} عقار ينتظر المراجعة`,'مراجعة العقارات المعلقة وإنشاء قرارات اعتماد منفصلة.',true);
 if(+ai.high)add('high','operations',`${ai.high} قرار AI عالي الأولوية`,'مراجعة مركز الموافقات اليوم.');
 if(+ads.spend>0 && +ads.conversions===0)add('high','marketing','إنفاق إعلاني دون تحويلات خلال 7 أيام','مراجعة الحملات قبل أي زيادة ميزانية.',true);
 if(!findings.length)add('low','system','التشغيل مستقر','لا توجد إشارة حرجة في الفحص الحالي؛ استمر بالمراقبة.');
 const row=(await pool.query(`INSERT INTO ai_business_autopilot_runs(snapshot,findings) VALUES($1,$2) RETURNING *`,[JSON.stringify(snapshot),JSON.stringify(findings)])).rows[0];return row;
 }finally{running=false}}
 app.get('/api/admin/business-autopilot',requireAdmin,async(_req,res)=>{try{await ensure();const latest=(await pool.query(`SELECT * FROM ai_business_autopilot_runs ORDER BY created_at DESC LIMIT 1`)).rows[0]||null;res.json({enabled:true,interval_minutes:minutes,mode:'monitor_analyze_propose',latest,safety:{financial_actions:'approval_required',campaign_budget_changes:'approval_required',deal_closing:'existing_protected_flow',commission_changes:'blocked'}})}catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/admin/business-autopilot/run',requireAdmin,async(_req,res)=>{try{res.json({run:await cycle()})}catch(e){res.status(500).json({error:e.message})}});
 ensure().then(()=>cycle()).catch(console.error);setInterval(()=>cycle().catch(console.error),minutes*60*1000).unref?.();
 return{cycle};
};
