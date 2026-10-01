'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const messageId=testId=>`<smtp-test-${testId}@aqartkom.app>`;

// Only return standardized DSN fields for the exact test and recipient.
function parseBounce(source,recipient,testIds){
 const raw=String(source||'').replace(/\r?\n[\t ]+/g,' ');
 if(!/Content-Type:\s*message\/delivery-status\b/i.test(raw))return [];
 const matched=testIds.filter(id=>raw.includes(messageId(id)));
 if(!matched.length)return [];
 const results=[];
 for(const block of raw.split(/\r?\n\r?\n/)){
  const target=block.match(/^Final-Recipient:\s*rfc822;\s*<?([^\s<>;]+)>?/im)?.[1];
  const action=block.match(/^Action:\s*(failed|delayed|delivered|relayed|expanded)\s*$/im)?.[1]?.toLowerCase();
  const status=block.match(/^Status:\s*([245]\.\d{1,3}\.\d{1,3})\s*$/im)?.[1];
  if(target?.toLowerCase()!==recipient.toLowerCase()||!action||!status)continue;
  for(const testId of matched)results.push({testId,action,status});
 }
 return results;
}

// Opt-in, bounded, read-only inspection of delivery reports for recorded tests.
// No message body, subject, credentials or provider prose is logged or saved.
async function checkDelivery({env=process.env,createClient,log=console.log,stateDir='/var/data/smtp-tests',now=Date.now()}={}){
 if(!env.GMAIL_DELIVERY_CHECK)return {skipped:true};
 const report=result=>{log('Hotel booking delivery check:',JSON.stringify(result));return result;};
 let request;
 try{
  request=JSON.parse(env.GMAIL_DELIVERY_CHECK);
  if(!request||typeof request.recipient!=='string'||request.recipient.length>254||! /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(request.recipient)||!Array.isArray(request.testIds)||request.testIds.length<1||request.testIds.length>2||request.testIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id)))throw Error();
  request.testIds=[...new Set(request.testIds)];
  for(const id of request.testIds){
   const marker=JSON.parse(await fs.readFile(path.join(stateDir,id+'.json'),'utf8'));
   if(marker.testId!==id||marker.accepted!==true)throw Error();
  }
 }catch(_error){return report({checked:false,code:'INVALID_TEST_REQUEST'});}
 if(env.SMTP_HOST!=='smtp.gmail.com'||!env.SMTP_USER||!env.SMTP_PASS)return report({checked:false,code:'GMAIL_NOT_CONFIGURED'});
 let client,lock,timer,result;
 try{
  const create=createClient||(options=>new (require('imapflow').ImapFlow)(options));
  client=create({host:'imap.gmail.com',port:993,secure:true,auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},logger:false,logRaw:false,emitLogs:false,disableAutoIdle:true,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:15000});
  client.on('error',()=>{});
  timer=setTimeout(()=>client.close(),60000);timer.unref();
  await client.connect();
  const mailboxes=await client.list();
  const mailbox=mailboxes.find(box=>box.specialUse==='\\All')?.path||'INBOX';
  lock=await client.getMailboxLock(mailbox,{readOnly:true});
  const tests=[];
  for(const testId of request.testIds){
   const ids=await client.search({header:{'Message-ID':messageId(testId)},since:new Date(now-48*3600000)},{uid:true});
   tests.push({testId,original_found:Array.isArray(ids)&&ids.length>0,delivery:'unconfirmed'});
  }
  const ids=await client.search({since:new Date(now-48*3600000),text:request.recipient,or:[{from:'mailer-daemon'},{from:'postmaster'}]},{uid:true});
  const candidates=Array.isArray(ids)?ids:[];
  for(const uid of candidates.slice(-10)){
   const message=await client.fetchOne(uid,{source:{start:0,maxLength:131072}},{uid:true});
   for(const bounce of parseBounce(message?.source?.toString('utf8'),request.recipient,request.testIds)){
    const test=tests.find(item=>item.testId===bounce.testId);
    Object.assign(test,{delivery:bounce.action,status:bounce.status});
   }
  }
  result={checked:true,tests,matched_reports:candidates.length,limited:candidates.length>10};
 }catch(error){
  const allowed=['ETIMEDOUT','ESOCKET','ENOTFOUND','ECONNREFUSED','ECONNRESET'];
  result={checked:false,code:error?.authenticationFailed?'AUTH_FAILED':allowed.includes(error?.code)?error.code:'IMAP_CHECK_FAILED'};
 }finally{
  lock?.release();
  if(client){try{await client.logout();}catch(_error){client.close();}}
  if(timer)clearTimeout(timer);
 }
 return report(result);
}

module.exports={checkDelivery,parseBounce};
