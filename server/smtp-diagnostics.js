'use strict';
let lastVerification={verified:null,checked_at:null};
const getSmtpStatus=()=>({...lastVerification});

function smtpOptions(env){
 const secure=String(env.SMTP_SECURE||'false')==='true';
 return {host:env.SMTP_HOST,port:Number(env.SMTP_PORT||587),secure,requireTLS:!secure,
  auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},
  dnsTimeout:15000,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:15000};
}

function safeError(error){
 const allowed=['EAUTH','ECONNECTION','ETIMEDOUT','ESOCKET','ETLS','EDNS','ENOTFOUND','ECONNREFUSED'];
 const result={code:allowed.includes(error?.code)?error.code:'PROVIDER_ERROR'};
 if(Number.isInteger(error?.responseCode)&&error.responseCode>=100&&error.responseCode<=599)result.responseCode=error.responseCode;
 return result;
}

// Authenticate without sending a message. Never log credentials or provider text.
async function verifySmtp({env=process.env,createTransport,log=console.log}={}){
 lastVerification={verified:null,checked_at:null};
 let transport;
 let result;
 try{
  if(!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASS){
   result={verified:false,code:'NOT_CONFIGURED'};
  }else{
   const create=createTransport||require('nodemailer').createTransport;
   transport=create(smtpOptions(env));
   await transport.verify();
   result={verified:true};
  }
 }catch(error){
  result={verified:false,...safeError(error)};
 }finally{
  try{transport?.close();}catch(_error){}
 }
 lastVerification={...result,checked_at:new Date().toISOString()};
 log('Hotel booking SMTP verification:',JSON.stringify(result));
 return result;
}

// An operator must explicitly set both variables for an authorized test. Claim the
// request on the persistent disk before sending so restarts cannot send it twice.
async function sendSmtpTest({env=process.env,createTransport,log=console.log,stateDir='/var/data/smtp-tests'}={}){
 const testId=String(env.SMTP_TEST_ID||''),to=String(env.SMTP_TEST_RECIPIENT||'').trim();
 if(!testId&&!to)return {skipped:true};
 const report=result=>{log('Hotel booking SMTP test:',JSON.stringify(result));return result;};
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(testId)||to.length>254||! /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to))return report({accepted:false,code:'INVALID_TEST_CONFIG'});
 if(!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASS)return report({accepted:false,testId,code:'NOT_CONFIGURED'});
 const fs=require('node:fs/promises'),path=require('node:path');
 const marker=path.join(stateDir,testId+'.json');
 let handle;
 try{
  await fs.mkdir(stateDir,{recursive:true,mode:0o700});
  handle=await fs.open(marker,'wx',0o600);
  await handle.writeFile(JSON.stringify({testId,status:'attempted',at:new Date().toISOString()}));
 }catch(error){
  return report({accepted:false,testId,skipped:true,code:error.code==='EEXIST'?'ALREADY_ATTEMPTED':'STATE_UNAVAILABLE'});
 }finally{await handle?.close().catch(()=>{});}
 let transport,result;
 try{
  const create=createTransport||require('nodemailer').createTransport;
  transport=create(smtpOptions(env));
  const info=await transport.sendMail({
   from:env.SMTP_FROM||env.SMTP_USER,to,
   subject:'اختبار بريد عقارتكم',
   text:'هذه رسالة اختبار لإرسال البريد من منصة عقارتكم.\nالرسالة لا تتعلق بحجز فعلي.\nمرجع الاختبار: '+testId,
   messageId:'<smtp-test-'+testId+'@aqartkom.app>'
  });
  const accepted=Array.isArray(info.accepted)&&info.accepted.some(address=>String(address).toLowerCase()===to.toLowerCase());
  result={accepted,testId,...(accepted?{}:{code:'RECIPIENT_NOT_ACCEPTED'})};
 }catch(error){result={accepted:false,testId,...safeError(error)};}
 finally{try{transport?.close();}catch(_error){}}
 try{await fs.writeFile(marker,JSON.stringify({...result,at:new Date().toISOString()}),{mode:0o600});}
 catch(_error){result.stateSaved=false;}
 return report(result);
}

module.exports={verifySmtp,sendSmtpTest,getSmtpStatus,smtpOptions};
