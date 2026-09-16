'use strict';

module.exports=function installAiListingStudio(app,{pool,getCurrentUser,requireAdmin}){
  const MODEL=process.env.OPENAI_LISTING_MODEL||'gpt-5.6';

  async function init(){
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_listing_studio_generations(
      id BIGSERIAL PRIMARY KEY,
      property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      model VARCHAR(100),
      source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      output JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(30) NOT NULL DEFAULT 'generated',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_at TIMESTAMPTZ
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_listing_studio_property ON ai_listing_studio_generations(property_id,created_at DESC)`);
  }
  init().catch(e=>console.error('AI Listing Studio init',e));

  function fallback(p){
    const place=[p.district,p.city].filter(Boolean).join('، ');
    const facts=[p.area?`${p.area} م²`:null,p.rooms?`${p.rooms} غرف`:null,p.baths?`${p.baths} حمامات`:null].filter(Boolean);
    const title=`${p.type} ${p.mode==='بيع'?'للبيع':'للإيجار'}${place?' في '+place:''}`.slice(0,190);
    const description=`فرصة ${p.mode==='بيع'?'للشراء':'للإيجار'}: ${p.type}${place?' في '+place:''}.${facts.length?' يتميز العقار بـ '+facts.join('، ')+'.':''} السعر ${Number(p.price).toLocaleString('ar')} ${p.currency||''}. تواصل عبر عقارتكم للحصول على التفاصيل وترتيب المعاينة.`;
    return {title,description,features:facts,seo:{meta_title:title,meta_description:description.slice(0,155),keywords:[p.type,p.city,p.district,p.mode].filter(Boolean)},social:{whatsapp:`${title}\n${description}`,instagram:`${title}\n\n${description}\n\n#عقارتكم #عقارات #${String(p.city||'عقار').replace(/\s+/g,'_')}`,paid_ad:`${title} — ${facts.join(' • ')}. تواصل الآن عبر عقارتكم.`},image_order:[],notes:['تم إنشاء النص من البيانات المتاحة فقط. راجع التفاصيل قبل النشر.']};
  }

  function parseOutput(j){
    if(j.output_text){try{return JSON.parse(j.output_text)}catch{}}
    const text=(j.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||x.value||'').join('');
    const m=text.match(/\{[\s\S]*\}/); if(m){try{return JSON.parse(m[0])}catch{}}
    return null;
  }

  async function generateAI(p,images){
    if(!process.env.OPENAI_API_KEY)return fallback(p);
    const prompt=`أنت محرر إعلانات عقارية لمنصة عقارتكم. أنشئ محتوى عربي احترافي ودقيق من البيانات فقط، دون اختراع مزايا أو قرب خدمات أو حالة تشطيب غير مذكورة. أعد JSON فقط بالمفاتيح: title, description, features (array), seo {meta_title,meta_description,keywords}, social {whatsapp,instagram,paid_ad}, image_order (array of image ids), notes (array). اجعل العنوان أقل من 90 حرفاً والوصف تسويقياً واضحاً. رتب الصور اعتماداً فقط على sort_order المتاح؛ لا تدّع تحليل محتوى الصورة. البيانات: ${JSON.stringify({property:p,images:images.map(x=>({id:x.id,sort_order:x.sort_order}))})}`;
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,input:prompt})});
    if(!r.ok)throw new Error(`OpenAI ${r.status}`);
    return parseOutput(await r.json())||fallback(p);
  }

  async function ownedProperty(req,id){
    const user=await getCurrentUser(req); if(!user)return {error:[401,'يجب تسجيل الدخول أولاً']};
    const q=await pool.query(`SELECT p.* FROM properties p WHERE p.id=$1 AND (p.owner_id=$2 OR p.office_id IN (SELECT o.id FROM offices o WHERE o.owner_id=$2) OR p.office_id=(SELECT office_id FROM users WHERE id=$2)) LIMIT 1`,[id,user.id]);
    if(!q.rows[0] && user.role!=='admin')return {error:[403,'لا تملك صلاحية هذا العقار']};
    if(!q.rows[0] && user.role==='admin'){const a=await pool.query('SELECT * FROM properties WHERE id=$1',[id]);if(!a.rows[0])return {error:[404,'العقار غير موجود']};return {user,property:a.rows[0]};}
    return {user,property:q.rows[0]};
  }

  app.post('/api/listing-studio/:id/generate',async(req,res)=>{try{
    const own=await ownedProperty(req,req.params.id);if(own.error)return res.status(own.error[0]).json({error:own.error[1]});
    const images=(await pool.query('SELECT id,url,sort_order FROM property_images WHERE property_id=$1 ORDER BY sort_order,id',[req.params.id])).rows;
    let output;try{output=await generateAI(own.property,images)}catch(e){console.error(e);output=fallback(own.property);output.notes=[...(output.notes||[]),'تعذر الاتصال بخدمة AI؛ تم استخدام الصياغة الاحتياطية.'];}
    const g=(await pool.query(`INSERT INTO ai_listing_studio_generations(property_id,user_id,model,source_snapshot,output) VALUES($1,$2,$3,$4,$5) RETURNING *`,[own.property.id,own.user.id,MODEL,JSON.stringify({property:own.property,images}),JSON.stringify(output)])).rows[0];
    res.json({data:{id:g.id,...output},disclaimer:'المحتوى مقترح ويجب مراجعته قبل اعتماده. لا يتم تغيير الإعلان تلقائياً.'});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر إنشاء محتوى الإعلان'});}});

  app.post('/api/listing-studio/:id/apply',async(req,res)=>{try{
    const own=await ownedProperty(req,req.params.id);if(own.error)return res.status(own.error[0]).json({error:own.error[1]});
    if(String(req.body.confirmation||'')!=='أوافق على تحديث الإعلان')return res.status(400).json({error:'يلزم التأكيد بعبارة: أوافق على تحديث الإعلان'});
    const generationId=Number(req.body.generation_id);const g=(await pool.query('SELECT * FROM ai_listing_studio_generations WHERE id=$1 AND property_id=$2',[generationId,own.property.id])).rows[0];if(!g)return res.status(404).json({error:'المسودة غير موجودة'});
    const out=g.output||{};const title=String(out.title||own.property.title).slice(0,200),description=String(out.description||own.property.description||'');
    const updated=(await pool.query('UPDATE properties SET title=$1,description=$2 WHERE id=$3 RETURNING *',[title,description,own.property.id])).rows[0];
    await pool.query(`UPDATE ai_listing_studio_generations SET status='applied',applied_at=NOW() WHERE id=$1`,[g.id]);
    res.json({ok:true,data:updated});
  }catch(e){console.error(e);res.status(500).json({error:'تعذر تطبيق المسودة'});}});

  app.get('/api/listing-studio/:id/history',async(req,res)=>{try{const own=await ownedProperty(req,req.params.id);if(own.error)return res.status(own.error[0]).json({error:own.error[1]});const rows=(await pool.query('SELECT id,model,output,status,created_at,applied_at FROM ai_listing_studio_generations WHERE property_id=$1 ORDER BY created_at DESC LIMIT 20',[req.params.id])).rows;res.json({data:rows});}catch(e){res.status(500).json({error:'تعذر تحميل المسودات'});}});

  app.get('/api/admin/listing-studio/overview',requireAdmin,async(_req,res)=>{try{const r=(await pool.query(`SELECT COUNT(*)::int generations,COUNT(DISTINCT property_id)::int properties,COUNT(*) FILTER(WHERE status='applied')::int applied FROM ai_listing_studio_generations`)).rows[0];res.json({data:r});}catch(e){res.status(500).json({error:'تعذر تحميل الإحصاءات'});}});
};
