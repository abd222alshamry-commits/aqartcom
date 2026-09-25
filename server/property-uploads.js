'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

function register(app,{pool,requireAuth,receiveImages,receiveVideos,createVideoPoster,uploadDir,mediaStore}) {
  async function owner(req,res,next) {
    try {
      const result=await pool.query('SELECT id FROM properties WHERE id=$1 AND owner_id=$2',[req.params.id,req.user.id]);
      if (!result.rows.length) return res.status(404).json({error:'العقار غير موجود أو لا تملك صلاحية تعديله'});
      next();
    } catch {res.status(500).json({error:'تعذر التحقق من العقار'});}
  }
  for (const kind of ['images','videos']) {
    app.post('/api/me/properties/:id/'+kind,requireAuth,owner,mediaStore.uploadGate,kind==='images'?receiveImages:receiveVideos,async(req,res)=>{
      req.mediaProcessing=true;
      const batch=mediaStore.batch(),cleanup=(req.files || []).map(f=>f.path);
      let client,transaction=false;
      try {
        if (!req.files?.length) return res.status(400).json({error:'اختر ملفات للرفع'});
        const items=[];
        for (const file of req.files) {
          let poster=null;
          if (kind==='videos') {
            const localPoster=await createVideoPoster(file.path);
            if (localPoster) {const p=path.join(uploadDir,path.basename(localPoster));cleanup.push(p);poster=await batch.add(p);}
          }
          items.push({url:await batch.add(file.path),poster,title:file.originalname || 'فيديو العقار'});
        }
        client=await pool.connect();await client.query('BEGIN');transaction=true;
        const locked=await client.query('SELECT id FROM properties WHERE id=$1 AND owner_id=$2 FOR UPDATE',[req.params.id,req.user.id]);
        if (!locked.rows.length) throw Error('Property no longer owned');
        const rows=[];
        if (kind==='images') {
          const count=await client.query('SELECT COALESCE(MAX(sort_order),-1) AS max FROM property_images WHERE property_id=$1',[req.params.id]);
          let order=Number(count.rows[0].max)+1;
          for (const item of items) rows.push((await client.query('INSERT INTO property_images(property_id,url,sort_order) VALUES($1,$2,$3) RETURNING *',[req.params.id,item.url,order++])).rows[0]);
        } else {
          const count=await client.query('SELECT COUNT(*)::int AS n FROM property_videos WHERE property_id=$1',[req.params.id]);
          let isPrimary=count.rows[0].n===0;
          for (const item of items) {rows.push((await client.query('INSERT INTO property_videos(property_id,url,poster_url,title,is_primary) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.params.id,item.url,item.poster,item.title,isPrimary])).rows[0]);isPrimary=false;}
        }
        await client.query('COMMIT');transaction=false;
        await batch.commit();
        res.status(201).json({data:rows});
      } catch (e) {
        if (transaction) await client.query('ROLLBACK').catch(()=>{});
        await batch.rollback();
        await Promise.all(cleanup.map(file=>fs.unlink(file).catch(()=>{})));
        console.error('Property media save failed:',e.code || e.name);
        res.status(503).json({error:'تعذر حفظ الملفات الآن. أعد المحاولة بعد قليل.'});
      } finally {client?.release();req.releaseMediaUpload?.();}
    });
  }
}
module.exports={register};
