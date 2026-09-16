module.exports=function(app,{pool,requireAdmin}){
 const q=async(sql,args=[])=> (await pool.query(sql,args)).rows;
 async function safe(sql,args=[],fallback=[]){try{return await q(sql,args)}catch{return fallback}}
 app.get('/api/admin/owner-unified-dashboard',requireAdmin,async(req,res)=>{try{
  const days=Math.max(1,Math.min(365,Number(req.query.days||30)));
  const [props,leads,deals,finance,hotels,offices,ads,risks,proposals]=await Promise.all([
   safe(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='active')::int active,COUNT(*) FILTER(WHERE status='pending')::int pending,COUNT(*) FILTER(WHERE status='sold')::int sold,COUNT(*) FILTER(WHERE status='rented')::int rented FROM properties`),
   safe(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE stage='won')::int won,COUNT(*) FILTER(WHERE stage IN ('new','contacted','interested','viewing','negotiation'))::int open FROM office_leads WHERE created_at>=NOW()-($1||' days')::interval`,[days]),
   safe(`SELECT COUNT(*) FILTER(WHERE status='completed')::int completed,COUNT(*) FILTER(WHERE status IN ('negotiation','reserved'))::int open,COALESCE(SUM(amount) FILTER(WHERE status='completed'),0) value,COALESCE(SUM(platform_commission) FILTER(WHERE status='completed'),0) commission FROM office_deals WHERE created_at>=NOW()-($1||' days')::interval`,[days]),
   safe(`SELECT COALESCE(SUM(total_amount),0) billed,COALESCE(SUM(paid_amount),0) collected,COALESCE(SUM(total_amount-paid_amount) FILTER(WHERE status NOT IN ('paid','void')),0) outstanding FROM electronic_invoices WHERE issue_date>=CURRENT_DATE-$1::int`,[days]),
   safe(`SELECT COUNT(*)::int bookings,COUNT(*) FILTER(WHERE status='cancelled')::int cancelled,COALESCE(SUM(total) FILTER(WHERE status<>'cancelled'),0) gross FROM hotel_bookings WHERE created_at>=NOW()-($1||' days')::interval`,[days]),
   safe(`SELECT o.id,o.name,COUNT(d.id) FILTER(WHERE d.status='completed')::int completed,COALESCE(SUM(d.platform_commission) FILTER(WHERE d.status='completed'),0) commission FROM offices o LEFT JOIN office_deals d ON d.office_id=o.id AND d.created_at>=NOW()-($1||' days')::interval GROUP BY o.id,o.name ORDER BY commission DESC LIMIT 5`,[days]),
   safe(`SELECT platform,COALESCE(SUM(spend),0) spend,COALESCE(SUM(conversions),0) conversions,COALESCE(SUM(conversion_value),0) conversion_value FROM ad_platform_daily_metrics WHERE metric_date>=CURRENT_DATE-$1::int GROUP BY platform ORDER BY spend DESC`,[days]),
   Promise.all([safe(`SELECT COUNT(*)::int n FROM office_leads WHERE stage NOT IN ('won','lost') AND next_follow_up<NOW()`),safe(`SELECT COUNT(*)::int n FROM electronic_invoices WHERE status NOT IN ('paid','void') AND due_date<CURRENT_DATE`),safe(`SELECT COUNT(*)::int n FROM properties WHERE status='pending'`)]),
   safe(`SELECT COUNT(*)::int n,COUNT(*) FILTER(WHERE priority IN ('high','critical'))::int high FROM ai_executive_proposals WHERE status='proposed'`)
  ]);
  const r={overdue_leads:risks[0]?.[0]?.n||0,overdue_invoices:risks[1]?.[0]?.n||0,pending_properties:risks[2]?.[0]?.n||0};
  res.json({period_days:days,properties:props[0]||{},leads:leads[0]||{},deals:deals[0]||{},finance:finance[0]||{},hotels:hotels[0]||{},top_offices:offices,ads,risks:r,executive_proposals:proposals[0]||{},currency_note:'تعرض القيم كما هي مخزنة في الأنظمة المصدرية؛ لا يتم دمج عملات مختلفة على أنها عملة واحدة.'});
 }catch(e){console.error(e);res.status(500).json({error:'تعذر تحميل مركز قيادة المالك'})}});
};
