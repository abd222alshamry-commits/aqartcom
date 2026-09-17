'use strict';

// All providers settle through one transaction. Never credit a cancelled payment.
module.exports = function createPaymentSettlement({pool, newFinanceInvoiceNo}) {
return async function finalizePaidPayment(paymentId, providerPaymentId, providerPayload=null){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const pay=(await client.query(`SELECT p.*,o.owner_id FROM payments p LEFT JOIN offices o ON o.id=p.office_id WHERE p.id=$1 FOR UPDATE OF p`,[paymentId])).rows[0];
    if(!pay) throw new Error('payment_missing'); if(pay.status==='paid'){await client.query('COMMIT');return {ok:true,status:'paid',already:true};}
    if(pay.status!=='pending') throw new Error('payment_not_pending');
    if(!Number.isFinite(Number(pay.amount)) || Number(pay.amount)<=0) throw new Error('invalid_payment_amount');
    if(providerPaymentId) await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[pay.provider,String(providerPaymentId)]);
    if(providerPaymentId){const d=(await client.query(`SELECT id FROM payments WHERE provider=$1 AND provider_payment_id=$2 AND id<>$3 LIMIT 1`,[pay.provider,providerPaymentId,pay.id])).rows[0];if(d)throw new Error('provider_payment_already_used');}
    const meta=pay.metadata||{};
    if(meta.kind==='wallet_topup'){
      await client.query(`INSERT INTO office_wallets(office_id,currency) VALUES($1,$2) ON CONFLICT (office_id) DO NOTHING`,[pay.office_id,pay.currency]);
      const w=(await client.query(`SELECT * FROM office_wallets WHERE office_id=$1 FOR UPDATE`,[pay.office_id])).rows[0]; if(String(w.currency)!==String(pay.currency))throw new Error('wallet_currency_mismatch');
      const balance=Number(w.balance)+Number(pay.amount); const nw=(await client.query(`UPDATE office_wallets SET balance=$1,updated_at=NOW() WHERE office_id=$2 RETURNING balance`,[balance,pay.office_id])).rows[0];
      await client.query(`UPDATE payments SET status='paid',paid_at=NOW(),provider_payment_id=COALESCE($2,provider_payment_id),invoice_no=COALESCE(invoice_no,$4),review_status=CASE WHEN review_status='pending' THEN 'approved' ELSE review_status END,reviewed_at=CASE WHEN review_status='pending' THEN NOW() ELSE reviewed_at END,metadata=metadata||$3::jsonb WHERE id=$1`,[pay.id,providerPaymentId||null,JSON.stringify(providerPayload?{provider_verified:true}:{}),newFinanceInvoiceNo()]);
      await client.query(`INSERT INTO wallet_transactions(office_id,type,amount,balance_after,payment_id,description,metadata) VALUES($1,'topup',$2,$3,$4,'شحن المحفظة الإعلانية',$5)`,[pay.office_id,pay.amount,nw.balance,pay.id,JSON.stringify({payment_id:pay.id,provider_payment_id:providerPaymentId||null})]);
    } else if(meta.kind==='subscription'){
      const plan=(await client.query('SELECT * FROM office_plans WHERE id=$1',[meta.plan_id])).rows[0];if(!plan)throw new Error('plan_missing');
      await client.query(`UPDATE office_subscriptions SET status='cancelled',updated_at=NOW() WHERE office_id=$1 AND status='active'`,[pay.office_id]);
      const days=plan.billing_period==='yearly'?365:plan.billing_period==='monthly'?30:3650;
      const sub=(await client.query(`INSERT INTO office_subscriptions(office_id,plan_id,status,starts_at,ends_at,payment_provider) VALUES($1,$2,'active',NOW(),NOW()+($3||' days')::interval,$4) RETURNING id`,[pay.office_id,plan.id,days,pay.provider])).rows[0];
      await client.query(`UPDATE payments SET status='paid',subscription_id=$1,paid_at=NOW(),provider_payment_id=COALESCE($2,provider_payment_id),invoice_no=COALESCE(invoice_no,$5),review_status=CASE WHEN review_status='pending' THEN 'approved' ELSE review_status END,reviewed_at=CASE WHEN review_status='pending' THEN NOW() ELSE reviewed_at END,metadata=metadata||$3::jsonb WHERE id=$4`,[sub.id,providerPaymentId||null,JSON.stringify(providerPayload?{provider_verified:true}:{}),pay.id,newFinanceInvoiceNo()]);
    }
    if(!['wallet_topup','subscription'].includes(meta.kind)) throw new Error('unsupported_payment_kind');
    await client.query('COMMIT'); return {ok:true,status:'paid'};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
};
