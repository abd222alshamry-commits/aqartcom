'use strict';

// Authenticate without sending a message. Never log credentials or provider text.
async function verifySmtp({env=process.env,createTransport,log=console.log}={}){
 let transport;
 let result;
 try{
  if(!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASS){
   result={verified:false,code:'NOT_CONFIGURED'};
  }else{
   const secure=String(env.SMTP_SECURE||'false')==='true';
   const create=createTransport||require('nodemailer').createTransport;
   transport=create({host:env.SMTP_HOST,port:Number(env.SMTP_PORT||587),secure,requireTLS:!secure,
    auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},
    dnsTimeout:15000,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:15000});
   await transport.verify();
   result={verified:true};
  }
 }catch(error){
  const allowed=['EAUTH','ECONNECTION','ETIMEDOUT','ESOCKET','ETLS','EDNS','ENOTFOUND','ECONNREFUSED'];
  result={verified:false,code:allowed.includes(error?.code)?error.code:'PROVIDER_ERROR'};
  if(Number.isInteger(error?.responseCode)&&error.responseCode>=100&&error.responseCode<=599)result.responseCode=error.responseCode;
 }finally{
  try{transport?.close();}catch(_error){}
 }
 log('Hotel booking SMTP verification:',JSON.stringify(result));
 return result;
}

module.exports={verifySmtp};
