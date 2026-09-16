const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
module.exports=function(app,{pool,requireAdmin}){
 const backupDir=path.join(__dirname,'..','backups');fs.mkdirSync(backupDir,{recursive:true});
 const version=require('../package.json').version;
 app.get('/api/ready',async(_q,r)=>{try{await pool.query('SELECT 1');r.json({ok:true,database:true,version})}catch(e){r.status(503).json({ok:false,database:false})}});
 app.get('/api/admin/production/readiness',requireAdmin,async(_q,r)=>{
  let database=false;try{await pool.query('SELECT 1');database=true}catch{}
  const configured=(...names)=>names.every(n=>Boolean(process.env[n]));
  const checks={database:{ok:database},https:{ok:process.env.NODE_ENV!=='production'||String(process.env.APP_URL||process.env.RENDER_EXTERNAL_URL||'').startsWith('https://')},sessions:{ok:true,method:'random server-side tokens; secure cookies in production'},uploads:{ok:fs.existsSync(path.join(__dirname,'..','uploads'))}};
  const integrations={openai:configured('OPENAI_API_KEY'),whatsapp:configured('WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID'),email:configured('SMTP_HOST','SMTP_USER','SMTP_PASS'),push:configured('VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY'),moyasar:configured('MOYASAR_SECRET_KEY','MOYASAR_PUBLISHABLE_KEY'),stripe:configured('STRIPE_SECRET_KEY'),paypal:configured('PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET'),booking:configured('BOOKING_API_TOKEN'),agoda:configured('AGODA_API_KEY'),expedia:configured('EXPEDIA_API_TOKEN')};
  r.json({version,score:Math.round(Object.values(checks).filter(x=>x.ok).length/Object.keys(checks).length*100),checks,integrations,notice:'الفحص يتحقق من الإعدادات الأساسية فقط. وجود مفاتيح الربط لا يثبت نجاح الاتصال الخارجي.'});
 });
 app.post('/api/admin/production/backup',requireAdmin,async(_q,r)=>{if(!process.env.DATABASE_URL)return r.status(400).json({error:'DATABASE_URL غير مضبوط'});const file=path.join(backupDir,`aqartkom-${new Date().toISOString().replace(/[:.]/g,'-')}.dump`);execFile('pg_dump',['--format=custom','--file',file,process.env.DATABASE_URL],{timeout:120000},e=>e?r.status(500).json({error:'فشل النسخ الاحتياطي'}):r.json({ok:true,file:path.basename(file)}));});
};
