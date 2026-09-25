'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const install=require('../server/ai-fraud-trust-center');
test('startup trust scan retries a transient database deadlock and completes without losing its checks',async()=>{
 let propertyReads=0,userReads=0;
 const pool={query:async sql=>{
  if(sql.includes('FROM properties p LEFT JOIN users')){propertyReads++;if(propertyReads===1)throw Object.assign(Error('deadlock detected'),{code:'40P01'});}
  if(sql.includes('FROM users u LEFT JOIN properties'))userReads++;
  return {rows:[]};
 }};
 const app={post(){},get(){},patch(){}};
 const result=await install(app,{pool,requireAdmin(){}}).startup;
 assert.equal(propertyReads,2);assert.equal(userReads,1);
 assert.deepEqual(result,{properties_assessed:0,high_risk_properties:0,users_assessed:0});
});
