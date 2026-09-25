'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {finished} = require('node:stream/promises');
const {S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command} = require('@aws-sdk/client-s3');

const TYPES = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm'};
function mediaPath(value) {
  return typeof value === 'string' && /^uploads\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|mp4|mov|webm)$/i.test(value) ? value : null;
}
async function hashes(file) {
  const sha = crypto.createHash('sha256'), md5 = crypto.createHash('md5');
  for await (const chunk of fs.createReadStream(file)) { sha.update(chunk); md5.update(chunk); }
  return {sha256:sha.digest('hex'),md5:md5.digest('base64')};
}
function createMediaStorage({uploadDir, env = process.env, client} = {}) {
  const root = path.resolve(uploadDir);
  const provider = env.MEDIA_STORAGE_PROVIDER || 'local';
  if (!['local','r2'].includes(provider)) throw Error('MEDIA_STORAGE_PROVIDER must be local or r2');
  let publicBase = '';
  if (env.R2_PUBLIC_BASE_URL) {
    const url = new URL(env.R2_PUBLIC_BASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || /(^|\.)r2\.dev$/i.test(url.hostname)) throw Error('R2_PUBLIC_BASE_URL must be an HTTPS custom-domain origin');
    publicBase = url.origin;
  }
  const bucket = env.R2_BUCKET || '';
  const targetGB = Number(env.MEDIA_STORAGE_TARGET_GB || 1000);
  if (!Number.isFinite(targetGB) || targetGB <= 0) throw Error('MEDIA_STORAGE_TARGET_GB must be positive');
  let uploading = null;
  async function uploadGate(req,res,next) {
    if (uploading) return res.status(429).json({error:'يوجد رفع قيد المعالجة. انتظر قليلًا ثم أعد المحاولة.'});
    const ticket = Symbol('upload');uploading = ticket;
    const release = () => {if(uploading===ticket)uploading=null;};
    req.releaseMediaUpload=release;
    const afterResponse=()=>{if(!req.mediaProcessing)release();};
    res.once('finish',afterResponse);res.once('close',afterResponse);
    try {
      const stat=await fs.promises.statfs(root);
      const batchBytes=req.path.endsWith('/images')?96*1024*1024:300*1024*1024;
      if (Number(stat.bavail)*Number(stat.bsize) < batchBytes+128*1024*1024) return res.status(507).json({error:'مساحة تجهيز الملفات منخفضة. تواصل مع الإدارة قبل رفع ملفات أخرى.'});
      next();
    } catch {release();res.status(503).json({error:'تعذر التحقق من مساحة الرفع.'});}
  }
  if (provider === 'r2') {
    if (!/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID || '') || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !publicBase) throw Error('R2 configuration incomplete: account, bucket, credentials and public domain are required');
    client ||= new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',maxAttempts:2});
  }
  function keyFromUrl(value) {
    if (typeof value !== 'string') return null;
    if (value.startsWith('/uploads/')) return mediaPath(value.slice(1));
    if (!publicBase) return null;
    try { const u = new URL(value); return u.origin === publicBase && !u.search && !u.hash ? mediaPath(u.pathname.slice(1)) : null; } catch { return null; }
  }
  function localPath(key) { return path.join(root,key.slice('uploads/'.length)); }
  async function inspect(file) {
    const relative = path.relative(root,path.resolve(file)).split(path.sep).join('/');
    const key = mediaPath('uploads/'+relative);
    if (!key) throw Error('File is outside the public media directory or unsupported');
    const stat = await fs.promises.lstat(file);
    const [realRoot,realFile] = await Promise.all([fs.promises.realpath(root),fs.promises.realpath(file)]);
    if (!stat.isFile() || !realFile.startsWith(realRoot+path.sep)) throw Error('Media must be a regular file inside uploads');
    return {key,size:stat.size,...await hashes(file)};
  }
  const send = command => client.send(command,{abortSignal:AbortSignal.timeout(120000)});
  async function head(key) {
    try { return await send(new HeadObjectCommand({Bucket:bucket,Key:key})); }
    catch (e) { if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return null; throw e; }
  }
  function matches(remote, info) { return remote && Number(remote.ContentLength) === info.size && remote.Metadata?.sha256 === info.sha256; }
  async function copy(file,{reuse = false} = {}) {
    if (provider !== 'r2') throw Error('Activate R2 configuration before copying media');
    const info = await inspect(file);
    if (reuse) {
      const existing = await head(info.key);
      if (existing) { if (!matches(existing,info)) throw Error('Remote object differs; refusing to overwrite'); return {...info,url:publicBase+'/'+info.key,created:false}; }
    }
    const body = fs.createReadStream(file);
    const bodyClosed = finished(body).catch(()=>{});
    try {
      await send(new PutObjectCommand({Bucket:bucket,Key:info.key,Body:body,ContentLength:info.size,ContentType:TYPES[path.extname(file).toLowerCase()],ContentMD5:info.md5,Metadata:{sha256:info.sha256},CacheControl:'public, max-age=86400',IfNoneMatch:'*'}));
    } finally { body.destroy(); await bodyClosed; }
    try {
      if (!matches(await head(info.key),info)) throw Error('Stored media verification failed');
    } catch (e) {
      await send(new DeleteObjectCommand({Bucket:bucket,Key:info.key})).catch(()=>{});
      throw e;
    }
    return {...info,url:publicBase+'/'+info.key,created:true};
  }
  function batch() {
    const files = [];
    return {
      async add(file) {
        if (provider === 'local') { const info = await inspect(file); files.push({file}); return '/'+info.key; }
        const result = await copy(file); files.push({file,...result}); return result.url;
      },
      async commit() {
        // Storage cleanup must not turn a committed database write into an error.
        if (provider === 'r2') await Promise.all(files.map(f=>fs.promises.unlink(f.file).catch(()=>console.warn('Media staging cleanup deferred'))));
      },
      async rollback() {
        for (const f of files) {
          if (f.created) await send(new DeleteObjectCommand({Bucket:bucket,Key:f.key})).catch(()=>console.warn('Media rollback cleanup deferred'));
          await fs.promises.unlink(f.file).catch(()=>{});
        }
      }
    };
  }
  async function remove(url) {
    const key = keyFromUrl(url); if (!key) return;
    if (provider === 'r2') await send(new DeleteObjectCommand({Bucket:bucket,Key:key}));
    await fs.promises.unlink(localPath(key)).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
  function redirectMissing(req,res,next) {
    if (!publicBase || !['GET','HEAD'].includes(req.method)) return next();
    // Mounted at /uploads, after express.static. Never proxy media bytes through Render.
    const key = mediaPath('uploads'+req.path);
    if (!key) return next();
    res.set('Cache-Control','public, max-age=300');
    return res.redirect(307,publicBase+'/'+key);
  }
  async function usage() {
    if (provider !== 'r2') throw Error('R2 is not configured');
    let token,bytes=0,objects=0;
    do {
      const page = await send(new ListObjectsV2Command({Bucket:bucket,ContinuationToken:token}));
      for (const item of page.Contents || []) {bytes+=Number(item.Size || 0);objects++;}
      token=page.IsTruncated?page.NextContinuationToken:undefined;
      if (page.IsTruncated && !token) throw Error('Incomplete storage inventory');
    } while (token);
    return {provider,objects,bytes,target_gb:targetGB,used_percent:bytes/(targetGB*1e9)*100,estimated_storage_usd_month:Math.max(0,bytes/1e9-10)*0.015};
  }
  return {provider,publicBase,batch,copy,inspect,head,matches,keyFromUrl,localPath,remove,redirectMissing,usage,uploadGate};
}
module.exports={createMediaStorage,mediaPath,hashes};
