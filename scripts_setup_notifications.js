#!/usr/bin/env node
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const root=path.resolve(__dirname);const envPath=path.join(root,'.env');const example=path.join(root,'.env.example');
function b64u(b){return Buffer.from(b).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
function vapid(){const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pj=publicKey.export({format:'jwk'}),sj=privateKey.export({format:'jwk'});return {publicKey:b64u(Buffer.concat([Buffer.from([4]),Buffer.from(pj.x,'base64url'),Buffer.from(pj.y,'base64url')])),privateKey:sj.d}}
let text=fs.existsSync(envPath)?fs.readFileSync(envPath,'utf8'):fs.readFileSync(example,'utf8');
if(!/^VAPID_PUBLIC_KEY=/m.test(text)||/^VAPID_PUBLIC_KEY=$/m.test(text)){const k=vapid();text=text.replace(/^VAPID_PUBLIC_KEY=.*$/m,`VAPID_PUBLIC_KEY=${k.publicKey}`).replace(/^VAPID_PRIVATE_KEY=.*$/m,`VAPID_PRIVATE_KEY=${k.privateKey}`);}
if(!fs.existsSync(envPath))fs.writeFileSync(envPath,text);else fs.writeFileSync(envPath,text);
console.log('تم إنشاء/تحديث .env وإضافة مفاتيح VAPID.');
const missing=[];for(const k of ['SMTP_HOST','SMTP_USER','SMTP_PASS','WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID']){if(!new RegExp('^'+k+'=(?![^\\n])','m').test(text) || new RegExp('^'+k+'=$','m').test(text))missing.push(k)}
console.log('بيانات لازمة للتفعيل الفعلي:',missing.length?missing.join(', '):'لا توجد بيانات ناقصة من الحقول الأساسية.');
console.log('شغّل npm install ثم npm start.');
