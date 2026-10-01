'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifySmtp}=require('../server/smtp-diagnostics');
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
