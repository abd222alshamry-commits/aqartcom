const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
module.exports=function(app,{pool,requireAdmin}){
 const backupDir=path.join(__dirname,'..','backups'); fs.mkdirSync(backupDir,{recursive:true});
 const safe=async(fn)=>{try{return await fn()}catch(e){return {ok:false,error:e.message}}};
 app.get('/api/health',(_q,r)=>r.json({ok:true,service:'aqartkom',version:'59.0.0',time:new Date().toISOString()}));
 app.get('/api/ready',async(_q,r)=>{try{await pool.query('SELECT 1');r.json({ok:true,database:true})}catch(e){r.status(503).json({ok:false,database:false})}});
 app.get('/api/admin/production/readiness',requireAdmin,async(_q,r)=>{const db=await safe(async()=>{await pool.query('SELECT 1');return {ok:true}});const checks={database:db,openai:{ok:!!process.env.OPENAI_API_KEY},whatsapp:{ok:!!(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID)},https:{ok:process.env.NODE_ENV!=='production'||String(process.env.APP_URL||'').startsWith('https://')},session_secret:{ok:!!process.env.SESSION_SECRET},backup:{ok:!!process.env.DATABASE_URL},cors:{ok:!!process.env.CORS_ORIGIN}};const ready=Object.values(checks).filter(x=>x.ok).length; r.json({version:'59.0.0',score:Math.round(ready/Object.keys(checks).length*100),checks});});
 app.post('/api/admin/production/backup',requireAdmin,async(_q,r)=>{if(!process.env.DATABASE_URL)return r.status(400).json({error:'DATABASE_URL غير مضبوط'});const file=path.join(backupDir,`aqartkom-${new Date().toISOString().replace(/[:.]/g,'-')}.dump`);execFile('pg_dump',['--format=custom','--file',file,process.env.DATABASE_URL],{timeout:120000},(e)=>e?r.status(500).json({error:'فشل النسخ الاحتياطي',details:e.message}):r.json({ok:true,file:path.basename(file)}));});
};
