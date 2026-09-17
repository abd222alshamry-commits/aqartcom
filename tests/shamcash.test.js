'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {PGlite} = require('@electric-sql/pglite');
const sham = require('../server/shamcash');
const createSettlement = require('../server/payment-settlement');

// Synthetic contract fixtures only: no real wallet, API credential or transfer.
const env = {SHAM_CASH_API_BASE_URL:'https://payments.example.test/lookup', SHAM_CASH_API_KEY:'test-only-key', SHAM_CASH_ACCOUNT_ADDRESS:'test-only-recipient'};
const created = new Date(Date.now() - 60000).toISOString();
function response(tx, overrides = {}) {
  return {success:true, data:{found:true, transaction:{transaction_id:tx, status:'completed', to_address:env.SHAM_CASH_ACCOUNT_ADDRESS, direction:'incoming', amount:100, currency:'SYP', created_at:new Date().toISOString(), ...overrides}}};
}
test('Sham Cash requires explicit HTTPS configuration and does not follow redirects', async () => {
  assert.equal(sham.isConfigured(env),true);
  for (const change of [{SHAM_CASH_API_BASE_URL:''},{SHAM_CASH_API_KEY:''},{SHAM_CASH_ACCOUNT_ADDRESS:''},{SHAM_CASH_API_BASE_URL:'http://payments.example.test'},{SHAM_CASH_API_BASE_URL:'https://payments.example.test/?token=secret'}]) assert.equal(sham.isConfigured({...env,...change}),false);
  await assert.rejects(sham.findTransaction('123',{env:{},fetchImpl:()=>assert.fail('must not call a provider')}),/غير مفعّل/);
  const result = await sham.findTransaction('123',{env,fetchImpl:async (url,opts)=>{
    assert.equal(url.searchParams.get('tx'),'123');
    assert.equal(opts.redirect,'error'); assert.equal(opts.headers['X-Api-Key'],'test-only-key'); assert.ok(opts.signal);
    return {ok:true,json:async()=>response('123')};
  }});
  assert.equal(result.data.transaction.transaction_id,'123');
  for (const fetchImpl of [async()=>{throw Error('network unavailable')},async()=>({ok:false,json:async()=>({success:true})}),async()=>({ok:true,json:async()=>{throw Error('not JSON')}})]) await assert.rejects(sham.findTransaction('123',{env,fetchImpl}),/لم تُحتسب/);
});

test('Sham Cash rejects unconfirmed, mismatched, outgoing and old transactions', () => {
  const local = {amount:'100.00',currency:'SYP',created_at:created};
  assert.ok(sham.verifiedTransaction(response('123'),local,'123',env.SHAM_CASH_ACCOUNT_ADDRESS));
  assert.equal(sham.verifiedTransaction({success:true,data:{found:false}},local,'123',env.SHAM_CASH_ACCOUNT_ADDRESS),null);
  const changes = [{status:'pending'},{status:'failed'},{status:'reversed'},{status:undefined},{to_address:undefined},{to_address:'other'},{transaction_id:'456'},{transaction_id:undefined},{amount:101},{amount:0},{amount:'NaN'},{currency:'USD'},{direction:'outgoing'},{created_at:'2000-01-01'},{created_at:undefined},{created_at:'invalid'},{created_at:new Date(Date.now()+3600000).toISOString()}];
  for (const change of changes) assert.throws(()=>sham.verifiedTransaction(response('123',change),local,'123',env.SHAM_CASH_ACCOUNT_ADDRESS),undefined,JSON.stringify(change));
  assert.throws(()=>sham.verifiedTransaction({success:false,data:response('123').data},local,'123',env.SHAM_CASH_ACCOUNT_ADDRESS));
});

test('synthetic checkout settles once, rejects reuse and preserves balances on failure', async t => {
  const db = new PGlite(); await db.waitReady; t.after(()=>db.close());
  await db.exec(fs.readFileSync(path.join(__dirname,'../server/db/schema.sql'),'utf8'));
  // PGlite has one connection and cannot exercise concurrent advisory locks.
  // All balance and status SQL runs here unchanged; this is a sequential test.
  const pool = {query:(...args)=>db.query(...args),connect:async()=>({query:(sql,args)=>sql.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args),release(){}})};
  const user = (await db.query("INSERT INTO users(name,email,password_hash) VALUES('Test owner','payments@example.test','no-login') RETURNING id")).rows[0].id;
  const office = (await db.query("INSERT INTO offices(owner_id,name,slug) VALUES($1,'Test office','payment-test-office') RETURNING id",[user])).rows[0].id;
  await db.query("INSERT INTO office_wallets(office_id,currency) VALUES($1,'SYP')",[office]);
  const create = async (overrides={}) => (await db.query(`INSERT INTO payments(user_id,office_id,amount,currency,provider,status,created_at,metadata) VALUES($1,$2,100,'SYP',$3,$4,$5,$6) RETURNING *`,[user,office,overrides.provider||'shamcash',overrides.status||'pending',created,JSON.stringify({kind:overrides.kind||'wallet_topup'})])).rows[0];
  const settle = createSettlement({pool,newFinanceInvoiceNo:()=>`TEST-${Date.now()}`});
  let remote = response('123'); let calls=0;
  const app=express();app.use(express.json());
  sham.register(app,{pool,env,finalizePaidPayment:settle,requireAuth:(req,res,next)=>{if(!req.get('x-test-user'))return res.sendStatus(401);req.user={id:req.get('x-test-user')};next();},lookup:async()=>{calls++;return remote;}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const verify=async (id,tx='123',uid=String(user))=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/checkout/${id}/shamcash/verify`,{method:'POST',headers:{'Content-Type':'application/json',...(uid?{'x-test-user':uid}:{})},body:JSON.stringify({transaction_id:tx})});return {status:r.status,body:r.status===401?{}:await r.json()};};
  const p=await create();
  assert.equal((await verify(p.id,'123','')).status,401);
  assert.equal((await verify(p.id,'123','99999')).status,404);
  assert.equal((await verify(p.id,'invalid')).status,400);
  assert.equal(calls,0);
  const paid=await verify(p.id);assert.equal(paid.status,200,JSON.stringify(paid));assert.equal(paid.body.status,'paid');
  const again=await verify(p.id);assert.equal(again.body.already,true);assert.equal(calls,1);
  assert.equal((await db.query('SELECT balance FROM office_wallets WHERE office_id=$1',[office])).rows[0].balance,'100.00');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM wallet_transactions')).rows[0].n,1);
  const duplicate=await create();assert.equal((await verify(duplicate.id)).status,409);
  for(const status of ['cancelled','refunded','failed']){
    const stopped=await create({status});assert.equal((await verify(stopped.id)).status,409);
    await assert.rejects(settle(stopped.id,'999',{}),/payment_not_pending/);
  }
  const wrong=await create({provider:'mock'});assert.equal((await verify(wrong.id)).status,400);
  const unknown=await create({kind:'hotel_booking'});await assert.rejects(settle(unknown.id,'998',{}),/unsupported_payment_kind/);
  const invalid=await create(); remote=response('456',{status:'pending'});assert.equal((await verify(invalid.id,'456')).status,409);
  remote={success:true,data:{found:false}};assert.equal((await verify(invalid.id,'456')).body.status,'not_found');
  assert.equal((await db.query('SELECT status FROM payments WHERE id=$1',[invalid.id])).rows[0].status,'pending');
  assert.equal((await db.query('SELECT balance FROM office_wallets WHERE office_id=$1',[office])).rows[0].balance,'100.00');
  const plan=(await db.query("INSERT INTO office_plans(name,slug,price,currency) VALUES('Test plan','payment-test-plan',100,'SYP') RETURNING id")).rows[0].id;
  const subscription=await create({kind:'subscription'});
  await db.query('UPDATE payments SET metadata=$2 WHERE id=$1',[subscription.id,JSON.stringify({kind:'subscription',plan_id:plan})]);
  assert.equal((await settle(subscription.id,'997',{})).status,'paid');
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM office_subscriptions WHERE office_id=$1 AND status='active'",[office])).rows[0].n,1);
  assert.equal((await settle(subscription.id,'997',{})).already,true);
});
