#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {Pool}=require('pg');
const {createMediaStorage}=require('../server/media-storage');
const {publicMediaKeys}=require('../server/media-inventory');

async function verifyPublic(store,info) {
  const response=await fetch(info.url,{signal:AbortSignal.timeout(120000),redirect:'error',headers:{'Cache-Control':'no-cache'}});
  if(!response.ok||!response.body)throw Error('Public media URL is not accessible');
  const hash=crypto.createHash('sha256');let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>info.size)throw Error('Public media size mismatch');hash.update(chunk);}
  if(bytes!==info.size||hash.digest('hex')!==info.sha256)throw Error('Public media checksum mismatch');
}
async function main() {
  const [command,...flags]=process.argv.slice(2);
  if(!['check','usage','migrate'].includes(command)||flags.some(f=>!['--copy','--prune'].includes(f))||(flags.includes('--copy')&&flags.includes('--prune'))|| (command!=='migrate'&&flags.length))throw Error('Usage: npm run storage:check | storage:usage | storage:migrate [-- --copy | -- --prune]');
  const uploadDir=path.resolve(process.env.MEDIA_UPLOAD_DIR||path.join(__dirname,'../uploads'));
  const remote=command!=='migrate'||flags.length>0;
  const store=createMediaStorage({uploadDir,env:{...process.env,MEDIA_STORAGE_PROVIDER:remote?'r2':'local'}});
  if(command==='usage') {
    const report=await store.usage();console.log(JSON.stringify(report,null,2));
    if(report.used_percent>=80)process.exitCode=2;
    return;
  }
  if(command==='check') {
    await fs.mkdir(uploadDir,{recursive:true});
    const file=path.join(uploadDir,'r2-check-'+crypto.randomUUID()+'.png');
    await fs.writeFile(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVt0AAAAASUVORK5CYII=','base64'),{flag:'wx'});
    let info;
    try {info=await store.copy(file);await verifyPublic(store,info);console.log('PASS: upload, metadata, public download and SHA-256 verified.');}
    finally {if(info)await store.remove(info.url);await fs.unlink(file).catch(()=>{});}
    return;
  }
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required to select only referenced public media');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:15000});
  const report={mode:flags[0]||'dry-run',referenced:0,local_files:0,local_bytes:0,copied:0,pruned:0,missing_local:0};
  try {
    const keys=await publicMediaKeys(pool,[process.env.APP_URL,process.env.RENDER_EXTERNAL_URL,store.publicBase]);report.referenced=keys.length;
    let remoteUsage=remote?await store.usage():null;
    for(const key of keys) {
      const file=store.localPath(key);let info;
      try{info=await store.inspect(file);}catch(e){if(e.code==='ENOENT'){report.missing_local++;continue;}throw e;}
      report.local_files++;report.local_bytes+=info.size;
      if(flags.includes('--copy')) {
        const existing=await store.head(key);
        if(!existing&&remoteUsage.bytes+info.size>remoteUsage.target_gb*1e9)throw Error('Copy would exceed the configured storage target');
        const copied=await store.copy(file,{reuse:true});
        if(copied.created)remoteUsage.bytes+=info.size;
        report.copied++;
      } else if(flags.includes('--prune')) {
        if(!store.matches(await store.head(key),info))throw Error('Refusing to remove local file: verified remote copy missing');
        await verifyPublic(store,{...info,url:store.publicBase+'/'+key});
        await fs.unlink(file);report.pruned++;
      }
    }
    console.log(JSON.stringify(report,null,2));
    if(!flags.length)console.log('Dry run only. No files copied or removed. Private documents and unreferenced files are excluded.');
  }finally{await pool.end();}
}
if(require.main===module)main().catch(e=>{console.error('Storage command failed:',e.code||e.name,/[\r\n]/.test(e.message)?'See configuration and retry.':e.message);process.exitCode=1;});
module.exports={verifyPublic,main};
