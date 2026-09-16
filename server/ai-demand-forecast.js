module.exports=function install(app,{pool,requireAdmin}){
 const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
 async function safe(sql,p=[]){try{return (await pool.query(sql,p)).rows}catch{return []}}
 async function ensure(){await pool.query(`CREATE TABLE IF NOT EXISTS ai_market_forecasts(
   id BIGSERIAL PRIMARY KEY, city VARCHAR(100) NOT NULL, district VARCHAR(150), mode VARCHAR(30) NOT NULL,
   property_type VARCHAR(80), currency VARCHAR(10) NOT NULL DEFAULT 'USD', horizon_days INTEGER NOT NULL DEFAULT 90,
   listings_count INTEGER NOT NULL DEFAULT 0, demand_score NUMERIC(6,2) NOT NULL DEFAULT 0,
   demand_forecast NUMERIC(6,2) NOT NULL DEFAULT 0, price_trend_pct NUMERIC(9,2) NOT NULL DEFAULT 0,
   projected_price_trend_pct NUMERIC(9,2) NOT NULL DEFAULT 0, expected_days_to_deal INTEGER,
   opportunity_score NUMERIC(6,2) NOT NULL DEFAULT 0, confidence NUMERIC(6,2) NOT NULL DEFAULT 0,
   signals JSONB NOT NULL DEFAULT '{}'::jsonb, generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 ); CREATE INDEX IF NOT EXISTS idx_ai_market_forecasts_scope ON ai_market_forecasts(city,district,mode,property_type,generated_at DESC);`)}
 async function build(horizon=90){await ensure(); horizon=Math.max(30,Math.min(365,Number(horizon)||90));
  const scopes=await safe(`SELECT p.city,p.district,p.mode,p.type property_type,COALESCE(p.currency,'USD') currency,
    COUNT(*) FILTER(WHERE p.status='active')::int listings,
    COALESCE(AVG(NULLIF(p.price/NULLIF(p.area,0),0)) FILTER(WHERE p.created_at>=NOW()-INTERVAL '90 days'),0) recent_ppm,
    COALESCE(AVG(NULLIF(p.price/NULLIF(p.area,0),0)) FILTER(WHERE p.created_at<NOW()-INTERVAL '90 days' AND p.created_at>=NOW()-INTERVAL '180 days'),0) prior_ppm,
    COUNT(*) FILTER(WHERE p.created_at>=NOW()-INTERVAL '30 days')::int new30,
    COALESCE(SUM(p.views_count) FILTER(WHERE p.status='active'),0)::bigint views
    FROM properties p WHERE p.created_at>=NOW()-INTERVAL '365 days' GROUP BY 1,2,3,4,5 HAVING COUNT(*)>=2 ORDER BY COUNT(*) DESC LIMIT 500`);
  const out=[];
  for(const s of scopes){const ev=(await safe(`SELECT COUNT(*) FILTER(WHERE e.event_type='favorite')::int favorites,COUNT(*) FILTER(WHERE e.event_type='inquiry')::int inquiries,COUNT(*) FILTER(WHERE e.event_type='view')::int event_views FROM user_property_events e JOIN properties p ON p.id=e.property_id WHERE p.city=$1 AND p.district IS NOT DISTINCT FROM $2 AND p.mode=$3 AND p.type=$4 AND COALESCE(p.currency,'USD')=$5 AND e.created_at>=NOW()-INTERVAL '90 days'`,[s.city,s.district,s.mode,s.property_type,s.currency]))[0]||{};
   const deals=(await safe(`SELECT COUNT(*)::int deals,COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(d.closed_at,d.created_at)-p.created_at))/86400),0) avg_days FROM office_deals d JOIN properties p ON p.id=d.property_id WHERE d.status='completed' AND p.city=$1 AND p.district IS NOT DISTINCT FROM $2 AND p.mode=$3 AND p.type=$4 AND COALESCE(p.currency,'USD')=$5 AND COALESCE(d.closed_at,d.created_at)>=NOW()-INTERVAL '180 days'`,[s.city,s.district,s.mode,s.property_type,s.currency]))[0]||{};
   const listings=Math.max(1,+s.listings), inquiries=+ev.inquiries||0, fav=+ev.favorites||0, views=Math.max(+s.views||0,+ev.event_views||0);
   const demand=clamp(20 + Math.min(35,inquiries/listings*18)+Math.min(20,fav/listings*8)+Math.min(15,views/listings/20)+Math.min(10,(+deals.deals||0)*3));
   const recent=+s.recent_ppm||0, prior=+s.prior_ppm||0, trend=prior>0?clamp((recent-prior)/prior*100,-40,40):0;
   const momentum=clamp((+s.new30||0)/listings*30,0,15); const demandForecast=clamp(demand+(demand-50)*0.15+momentum-5);
   const projected=clamp(trend*(horizon/90)*0.7+(demandForecast-50)*0.08,-30,30);
   const days=+deals.avg_days>0?Math.round(clamp(+deals.avg_days,7,365)):Math.round(clamp(150-demandForecast*1.25,20,180));
   const opportunity=clamp(demandForecast*0.55+clamp(projected+20,0,40)*0.75+clamp(100-days/2,0,100)*0.15);
   const confidence=clamp(25+Math.min(35,listings*3)+Math.min(20,(+deals.deals||0)*5)+Math.min(20,(inquiries+fav)*2));
   const signals={views,inquiries,favorites:fav,deals:+deals.deals||0,recent_price_per_sqm:recent,prior_price_per_sqm:prior,new_listings_30d:+s.new30||0,method:'historical-signals-v79'};
   const row=(await pool.query(`INSERT INTO ai_market_forecasts(city,district,mode,property_type,currency,horizon_days,listings_count,demand_score,demand_forecast,price_trend_pct,projected_price_trend_pct,expected_days_to_deal,opportunity_score,confidence,signals) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[s.city,s.district,s.mode,s.property_type,s.currency,horizon,listings,demand,demandForecast,trend,projected,days,opportunity,confidence,signals])).rows[0]; out.push(row)
  } return out;
 }
 app.post('/api/admin/market-forecast/generate',requireAdmin,async(req,res)=>{try{const rows=await build(req.body?.horizon_days);res.json({ok:true,count:rows.length,forecasts:rows})}catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/admin/market-forecast',requireAdmin,async(req,res)=>{try{await ensure();const limit=Math.max(10,Math.min(300,Number(req.query.limit)||100));const rows=await safe(`SELECT DISTINCT ON(city,COALESCE(district,''),mode,property_type,currency) * FROM ai_market_forecasts ORDER BY city,COALESCE(district,''),mode,property_type,currency,generated_at DESC`);const sorted=rows.sort((a,b)=>Number(b.opportunity_score)-Number(a.opportunity_score)).slice(0,limit);res.json({forecasts:sorted,methodology:'توقع إرشادي مبني على بيانات عقارتكم التاريخية: العرض، المشاهدات، المفضلة، الاستفسارات، الصفقات، سرعة الإغلاق واتجاه سعر المتر. ليس ضماناً لحركة السوق المستقبلية.',currencies_separate:true})}catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/admin/market-forecast/summary',requireAdmin,async(req,res)=>{try{await ensure();const rows=await safe(`SELECT DISTINCT ON(city,COALESCE(district,''),mode,property_type,currency) * FROM ai_market_forecasts ORDER BY city,COALESCE(district,''),mode,property_type,currency,generated_at DESC`);const top=[...rows].sort((a,b)=>+b.opportunity_score-+a.opportunity_score).slice(0,10);res.json({top_opportunities:top,high_demand:rows.filter(x=>+x.demand_forecast>=70).length,rising:rows.filter(x=>+x.projected_price_trend_pct>3).length,falling:rows.filter(x=>+x.projected_price_trend_pct< -3).length,scopes:rows.length})}catch(e){res.status(500).json({error:e.message})}});
 return {build};
}
