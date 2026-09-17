'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const {pipeline} = require('node:stream/promises');
const {Transform} = require('node:stream');
const {promisify} = require('node:util');
const run = promisify(require('node:child_process').execFile);
const MAX_BYTES = 100 * 1024 * 1024;
const privateIPv4 = new net.BlockList();
for (const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) privateIPv4.addSubnet(address,prefix);
const globalIPv6 = new net.BlockList(); globalIPv6.addSubnet('2000::',3,'ipv6');
const specialIPv6 = new net.BlockList();
for (const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16]]) specialIPv6.addSubnet(address,prefix,'ipv6');
function publicAddress(address) {
  const family = net.isIP(address);
  return family === 4 ? !privateIPv4.check(address) : family === 6 && globalIPv6.check(address,'ipv6') && !specialIPv6.check(address,'ipv6');
}
function videoUrl(value) {
  let url; try { url = new URL(value); } catch { throw Error('أدخل رابط ملف فيديو مباشر يبدأ بـ HTTPS.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw Error('استخدم رابط HTTPS مباشرًا دون بيانات دخول.');
  if (/(^|\.)(facebook\.com|fb\.watch|youtube\.com|youtu\.be)$/.test(url.hostname)) throw Error('هذا رابط صفحة وليس ملف فيديو. اختر ملف الفيديو من جهازك أو رابط تنزيل مباشر يرسله المكتب.');
  return url;
}
async function downloadVideo(value, destination) {
  let url = videoUrl(value);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 120000);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const host = url.hostname.replace(/^\[|\]$/g,'');
      const addresses = net.isIP(host) ? [{address:host,family:net.isIP(host)}] : await dns.lookup(host,{all:true,verbatim:true});
      if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw Error('هذا العنوان غير مسموح لتنزيل الملفات.');
      const chosen = addresses[0];
      const response = await new Promise((resolve,reject) => {
        // Pin the validated address for this request, including every redirect.
        const request = https.get(url,{agent:false,signal:abort.signal,headers:{Accept:'video/*, application/octet-stream'},lookup:(_host,options,callback) => options.all ? callback(null,[chosen]) : callback(null,chosen.address,chosen.family)},resolve);
        request.setTimeout(15000,() => request.destroy(Error('انتهت مهلة الاتصال بمصدر الفيديو.')));
        request.on('error',reject);
      });
      if ([301,302,303,307,308].includes(response.statusCode)) {
        const next = response.headers.location; response.destroy();
        if (!next || redirects === 3) throw Error('تعذر متابعة رابط تنزيل الفيديو.');
        url = videoUrl(new URL(next,url).href); continue;
      }
      const type = String(response.headers['content-type'] || '').split(';')[0].trim();
      if (response.statusCode !== 200 || !/^(video\/(mp4|webm|quicktime)|application\/octet-stream)$/.test(type)) {
        response.destroy(); throw Error('الرابط لا يقدم ملف فيديو متاحًا للتنزيل. استخدم الملف الأصلي.');
      }
      if (Number(response.headers['content-length']) > MAX_BYTES) { response.destroy(); throw Error('الحد الأقصى للفيديو 100 ميغابايت.'); }
      let size = 0;
      const limit = new Transform({transform(chunk,encoding,done) { size += chunk.length; done(size > MAX_BYTES ? Error('الحد الأقصى للفيديو 100 ميغابايت.') : null,chunk); }});
      await pipeline(response,limit,fs.createWriteStream(destination,{flags:'wx'}),{signal:abort.signal});
      if (!size) throw Error('ملف الفيديو فارغ.');
      return {source_host:url.hostname,size};
    }
  } catch (error) { await fsp.rm(destination,{force:true}); throw error; }
  finally { clearTimeout(timeout); }
}
async function probe(file) {
  const {stdout} = await run('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',file],{timeout:20000,maxBuffer:1024*1024});
  return JSON.parse(stdout);
}
async function prepareVideo(input, output, poster) {
  const handle = await fsp.open(input,'r');
  const magic = Buffer.alloc(32); try { await handle.read(magic,0,32,0); } finally { await handle.close(); }
  if (magic.toString('ascii',4,8) !== 'ftyp' && magic.readUInt32BE(0) !== 0x1a45dfa3) throw Error('الملف ليس فيديو MP4 أو MOV أو WebM صالحًا.');
  let info; try { info = await probe(input); } catch { throw Error('تعذر قراءة الفيديو. اختر ملفًا سليمًا.'); }
  const video = info.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = info.streams?.find(s => s.codec_type === 'audio');
  const duration = Number(info.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || duration > 600) throw Error('اختر فيديو صالحًا لا تتجاوز مدته 10 دقائق.');
  const compatible = video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' && video.width <= 1920 && video.height <= 1920;
  const encoding = compatible ? ['-c:v','copy'] : ['-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-vf',"scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"];
  try {
    await run('ffmpeg',['-nostdin','-v','error','-threads','1','-protocol_whitelist','file,pipe','-i',input,'-map','0:v:0','-map','0:a:0?',...encoding,'-threads','1','-filter_threads','1','-c:a',audio?.codec_name === 'aac' ? 'copy' : 'aac','-b:a','128k','-map_metadata','-1','-movflags','+faststart','-fs',String(MAX_BYTES),'-y',output],{timeout:10*60*1000,maxBuffer:1024*1024});
    const saved = await probe(output), outputDuration = Number(saved.format?.duration);
    if (!Number.isFinite(outputDuration) || Math.abs(outputDuration-duration) > Math.max(2,duration*.02)) throw Error('incomplete conversion');
    const size = (await fsp.stat(output)).size;
    if (!size || size > MAX_BYTES) throw Error('output size exceeded');
    let hasPoster = false;
    try {
      await run('ffmpeg',['-nostdin','-v','error','-threads','1','-protocol_whitelist','file,pipe','-ss',String(Math.min(1,duration/2)),'-i',output,'-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease','-threads','1','-filter_threads','1','-y',poster],{timeout:20000,maxBuffer:1024*1024});
      hasPoster = true;
    } catch { await fsp.rm(poster,{force:true}); }
    return {size_bytes:size,duration:outputDuration,has_audio:!!audio,hasPoster};
  } catch { throw Error('تعذر تجهيز الفيديو كاملًا. جرّب ملف MP4 أصغر.'); }
}
module.exports = {MAX_BYTES,publicAddress,videoUrl,downloadVideo,prepareVideo};
