'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifySmtp,sendSmtpTest}=require('../server/smtp-diagnostics');
const env={SMTP_HOST:'smtp.example.test',SMTP_USER:'sender@example.test',SMTP_PASS:'private-test-password'};

test('SMTP check authenticates with TLS, closes connection and never sends mail',async()=>{
 let verified=0,closed=0;
 const logs=[];
 const result=await verifySmtp({env,log:(...args)=>logs.push(args),createTransport:options=>{
  assert.equal(options.requireTLS,true);
  return {verify:async()=>{verified++;},close:()=>{closed++;},sendMail:()=>assert.fail('diagnostics must not send mail')};
 }});
 assert.deepEqual(result,{verified:true});assert.equal(verified,1);assert.equal(closed,1);
 assert.ok(!JSON.stringify(logs).includes(env.SMTP_PASS));
});

test('SMTP authentication failure reports only safe codes and never credentials or provider text',async()=>{
 const logs=[];let closed=false;
 const result=await verifySmtp({env,log:(...args)=>logs.push(args),createTransport:()=>({
  verify:async()=>{throw Object.assign(new Error(env.SMTP_PASS),{code:'EAUTH',responseCode:535,response:'secret '+env.SMTP_PASS});},
  close:()=>{closed=true;}
 })});
 assert.deepEqual(result,{verified:false,code:'EAUTH',responseCode:535});assert.ok(closed);
 assert.ok(!JSON.stringify(logs).includes(env.SMTP_PASS));assert.ok(!JSON.stringify(logs).includes(env.SMTP_USER));
});

test('unknown SMTP errors cannot expose arbitrary provider content in logs',async()=>{
 const logs=[];
 const result=await verifySmtp({env,log:(...args)=>logs.push(args),createTransport:()=>{throw {code:env.SMTP_PASS,responseCode:env.SMTP_PASS};}});
 assert.deepEqual(result,{verified:false,code:'PROVIDER_ERROR'});assert.ok(!JSON.stringify(logs).includes(env.SMTP_PASS));
});

test('unconfigured SMTP performs no network operation',async()=>{
 const result=await verifySmtp({env:{},log:()=>{},createTransport:()=>assert.fail('no connection expected')});
 assert.deepEqual(result,{verified:false,code:'NOT_CONFIGURED'});
});

async function stateDirectory(t){
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aqartkom-smtp-test-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;
}

test('authorized SMTP test sends once across concurrent attempts and server restarts',async t=>{
 const stateDir=await stateDirectory(t),logs=[];let sent=0;
 const options={stateDir,env:{...env,SMTP_TEST_ID:'one-authorized-test',SMTP_TEST_RECIPIENT:'recipient@example.test'},log:(...args)=>logs.push(args),createTransport:()=>({
  sendMail:async mail=>{
   sent++;assert.equal(mail.to,'recipient@example.test');assert.equal(mail.subject,'اختبار بريد عقارتكم');
   assert.equal(mail.from,env.SMTP_USER);assert.match(mail.text,/لا تتعلق بحجز فعلي/);
   return {accepted:[mail.to],messageId:mail.messageId};
  },close:()=>{}
 })};
 const results=await Promise.all([sendSmtpTest(options),sendSmtpTest(options)]);
 assert.equal(results.filter(r=>r.accepted).length,1);assert.equal(sent,1);
 assert.equal((await sendSmtpTest(options)).code,'ALREADY_ATTEMPTED');assert.equal(sent,1);
 assert.ok(!JSON.stringify(logs).includes(env.SMTP_PASS));
});

test('SMTP test is disabled by default and rejects multiple recipients before connecting',async t=>{
 const stateDir=await stateDirectory(t);
 const options={env,stateDir,log:()=>{},createTransport:()=>assert.fail('no connection expected')};
 assert.deepEqual(await sendSmtpTest(options),{skipped:true});
 for(const to of ['one@example.test,two@example.test','one@example.test\nBcc: other@example.test']){
  const result=await sendSmtpTest({...options,env:{...env,SMTP_TEST_ID:'invalid-recipient',SMTP_TEST_RECIPIENT:to}});
  assert.equal(result.code,'INVALID_TEST_CONFIG');
 }
});

test('failed SMTP test does not retry or log credentials',async t=>{
 const stateDir=await stateDirectory(t),logs=[];let sent=0;
 const options={stateDir,env:{...env,SMTP_TEST_ID:'failed-once',SMTP_TEST_RECIPIENT:'recipient@example.test'},log:(...args)=>logs.push(args),createTransport:()=>({
  sendMail:async()=>{sent++;throw Object.assign(Error(env.SMTP_PASS),{code:'EAUTH',responseCode:535});},close:()=>{}
 })};
 assert.equal((await sendSmtpTest(options)).code,'EAUTH');
 assert.equal((await sendSmtpTest(options)).code,'ALREADY_ATTEMPTED');assert.equal(sent,1);
 assert.ok(!JSON.stringify(logs).includes(env.SMTP_PASS));
});

test('SMTP test does not claim acceptance when provider rejects the recipient',async t=>{
 const result=await sendSmtpTest({stateDir:await stateDirectory(t),env:{...env,SMTP_TEST_ID:'rejected-once',SMTP_TEST_RECIPIENT:'recipient@example.test'},log:()=>{},createTransport:()=>({
  sendMail:async()=>({accepted:[],rejected:['recipient@example.test']}),close:()=>{}
 })});
 assert.equal(result.accepted,false);assert.equal(result.code,'RECIPIENT_NOT_ACCEPTED');
});
