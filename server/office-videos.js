'use strict';
const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const {readOfficeListings,data} = require('./office-listings');
const {MAX_BYTES,downloadVideo,prepareVideo} = require('./office-video-store');
const reserve = 128 * 1024 * 1024;
module.exports = function registerOfficeVideos(app,{pool,requireAdmin,uploadDir}) {
  const tempDir = path.resolve(uploadDir,'../private_uploads/office-video-tmp');
  let busy = false;
  async function space() { const s = await fs.statfs(uploadDir); return {free_bytes:Number(s.bavail)*Number(s.bsize),total_bytes:Number(s.blocks)*Number(s.bsize)}; }
  const uploader = multer({storage:multer.diskStorage({destination:(_req,_file,cb) => cb(null,tempDir),filename:(_req,_file,cb) => cb(null,crypto.randomUUID()+'.input')}),limits:{files:1,fileSize:MAX_BYTES,fields:0},fileFilter:(_req,file,cb) => cb(null,/\.(mp4|mov|webm)$/i.test(file.originalname))}).single('video');
  function sameOrigin(req,res,next) {
    try { if (req.headers.origin && new URL(req.headers.origin).host !== req.get('host')) return res.status(403).json({error:'افتح صفحة الإدارة من الموقع نفسه.'}); }
    catch { return res.sendStatus(403); }
    next();
  }
  app.get('/api/admin/office-videos',requireAdmin,async(req,res) => {
    try { res.set('Cache-Control','no-store');res.json({data:await readOfficeListings(pool),storage:await space(),busy,max_bytes:MAX_BYTES}); }
    catch { res.status(500).json({error:'تعذر تحميل فيديوهات المكاتب.'}); }
  });
  async function save(req,res,method) {
    if (busy) return res.status(409).json({error:'يوجد فيديو قيد الحفظ الآن. انتظر اكتماله ثم أعد المحاولة.'});
    busy = true;
    let input, output, poster, reply, committed = false;
    const problem = (status,message) => Object.assign(Error(message),{status});
    try {
      if (!/^\d+$/.test(req.params.id)) throw problem(404,'الإعلان غير موجود.');
      const listing = (await pool.query("SELECT id,title,raw_data->'local_video' AS local_video FROM market_listings WHERE id=$1 AND status='published' AND raw_data->>'import_batch'=$2",[req.params.id,data.snapshot])).rows[0];
      if (!listing) throw problem(404,'الإعلان غير موجود أو أُخفي.');
      if ((await space()).free_bytes < reserve+MAX_BYTES*2) throw problem(507,'المساحة المتاحة لا تكفي لحفظ فيديو جديد وتجهيزه.');
      await fs.mkdir(tempDir,{recursive:true});
      if (method === 'upload') {
        await new Promise((resolve,reject) => uploader(req,res,error => error ? reject(error) : resolve()));
        if (!req.file) throw problem(400,'اختر ملف MP4 أو MOV أو WebM.');
        input = req.file.path;
      } else {
        input = path.join(tempDir,crypto.randomUUID()+'.input');
        await downloadVideo(String(req.body?.url || ''),input);
      }
      const name = 'office-'+crypto.randomBytes(16).toString('hex');
      output = path.join(tempDir,name+'.mp4'); poster = path.join(tempDir,name+'.jpg');
      const info = await prepareVideo(input,output,poster);
      const publishedVideo = path.join(uploadDir,name+'.mp4'), publishedPoster = path.join(uploadDir,name+'.jpg');
      await fs.rename(output,publishedVideo); output = publishedVideo;
      if (info.hasPoster) { await fs.rename(poster,publishedPoster); poster = publishedPoster; }
      const local = {url:'/uploads/'+name+'.mp4',poster:info.hasPoster?'/uploads/'+name+'.jpg':null,title:listing.title,source_type:'upload',size_bytes:info.size_bytes,duration:info.duration,has_audio:info.has_audio,saved_at:new Date().toISOString()};
      const result = await pool.query("UPDATE market_listings SET raw_data=jsonb_set(COALESCE(raw_data,'{}'::jsonb),'{local_video}',$1::jsonb),updated_at=NOW() WHERE id=$2 AND status='published' RETURNING id",[JSON.stringify(local),listing.id]);
      if (!result.rows.length) throw Error('أُخفي الإعلان أثناء الحفظ. لم يتم استبدال الفيديو.');
      committed = true;
      // Only remove this feature's previous generated files after the database commit.
      for (const old of [listing.local_video?.url,listing.local_video?.poster]) {
        if (/^\/uploads\/office-[a-f0-9]{32}\.(mp4|jpg)$/.test(old || '')) await fs.rm(path.join(uploadDir,path.basename(old)),{force:true}).catch(() => {});
      }
      reply = {status:201,body:{data:local,message:'تم حفظ الفيديو وربطه بالإعلان.'}};
    } catch (error) {
      console.error('Office video save:',error.code || error.name);
      const message = error.code === 'LIMIT_FILE_SIZE' ? 'الحد الأقصى للفيديو 100 ميغابايت.' : error instanceof multer.MulterError ? 'اختر ملف فيديو واحدًا فقط.' : /[\u0600-\u06ff]/.test(error.message) ? error.message : 'تعذر حفظ الفيديو. تأكد من الملف أو رابط التنزيل ثم أعد المحاولة.';
      reply = {status:error.status || 400,body:{error:message}};
    } finally {
      for (const file of [input,!committed&&output,!committed&&poster].filter(Boolean)) await fs.rm(file,{force:true}).catch(() => {});
      busy = false;
    }
    if (!res.headersSent) res.status(reply.status).json(reply.body);
  }
  app.post('/api/admin/office-videos/:id/upload',requireAdmin,sameOrigin,(req,res) => save(req,res,'upload'));
  app.post('/api/admin/office-videos/:id/import',requireAdmin,sameOrigin,(req,res) => save(req,res,'import'));
};
