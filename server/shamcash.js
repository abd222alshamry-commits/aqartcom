'use strict';

// This adapter retains the existing find_tx contract. An approved endpoint and
// its response contract must be checked before enabling real payments.
class PaymentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function isConfigured(env = process.env) {
  if (![env.SHAM_CASH_API_KEY, env.SHAM_CASH_ACCOUNT_ADDRESS, env.SHAM_CASH_API_BASE_URL].every(x => String(x || '').trim())) return false;
  try {
    const url = new URL(env.SHAM_CASH_API_BASE_URL);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
async function findTransaction(tx, {env = process.env, fetchImpl = fetch} = {}) {
  if (!isConfigured(env)) throw new PaymentError(503, 'الدفع عبر شام كاش غير مفعّل حالياً. لا تحوّل أي مبلغ.');
  const url = new URL(env.SHAM_CASH_API_BASE_URL);
  url.searchParams.set('resource', 'shamcash');
  url.searchParams.set('action', 'find_tx');
  url.searchParams.set('tx', tx);
  url.searchParams.set('account_address', env.SHAM_CASH_ACCOUNT_ADDRESS);
  try {
    const response = await fetchImpl(url, {
      headers: {'X-Api-Key': env.SHAM_CASH_API_KEY, Accept: 'application/json'},
      redirect: 'error', signal: AbortSignal.timeout(10000)
    });
    const body = await response.json();
    if (!response.ok || body.success !== true) throw new Error('lookup_failed');
    return body;
  } catch {
    throw new PaymentError(503, 'تعذر الاتصال بخدمة التحقق. لم تُحتسب أي دفعة؛ حاول لاحقاً.');
  }
}
function verifiedTransaction(remote, local, tx, recipient) {
  if (remote?.success !== true) throw new PaymentError(503, 'تعذر تأكيد نتيجة خدمة الدفع.');
  if (remote?.data?.found === false) return null;
  const t = remote?.data?.transaction;
  if (remote?.data?.found !== true || !t || typeof t !== 'object') throw new PaymentError(503, 'بيانات التحقق غير مكتملة. لم تُحتسب الدفعة.');
  const remoteId = String(t.transaction_id ?? t.id ?? t.tx ?? '');
  if (remoteId !== tx) throw new PaymentError(400, 'رقم التحويل لا يطابق العملية المطلوبة.');
  if (!['completed', 'success', 'successful', 'paid'].includes(String(t.status || '').toLowerCase())) throw new PaymentError(409, 'التحويل غير مؤكد النجاح بعد.');
  if (!recipient || String(t.to_address || '') !== recipient) throw new PaymentError(400, 'لم يتم تأكيد وصول التحويل إلى حساب عقارتكم.');
  if (t.direction && !['incoming', 'in', 'credit'].includes(String(t.direction).toLowerCase())) throw new PaymentError(400, 'العملية ليست تحويلاً وارداً.');
  const amount = Number(t.amount), expected = Number(local.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(expected) || amount !== expected || String(t.currency || '').toUpperCase() !== 'SYP' || String(local.currency).toUpperCase() !== 'SYP') throw new PaymentError(400, 'المبلغ أو العملة لا تطابق عملية الشحن المطلوبة.');
  const created = Date.parse(local.created_at), received = Date.parse(t.created_at || t.timestamp || '');
  if (!Number.isFinite(created) || !Number.isFinite(received) || received < created || received > Date.now() + 60000) throw new PaymentError(400, 'تاريخ التحويل غير صالح لهذه العملية.');
  return t;
}
function register(app, {pool, requireAuth, finalizePaidPayment, env = process.env, lookup = findTransaction}) {
  app.post('/api/checkout/:id/shamcash/verify', requireAuth, async (req, res) => {
    try {
      const local = (await pool.query(`SELECT p.* FROM payments p LEFT JOIN offices o ON o.id=p.office_id WHERE p.id=$1 AND (p.user_id=$2 OR o.owner_id=$2)`, [req.params.id, req.user.id])).rows[0];
      if (!local) return res.status(404).json({error: 'عملية الدفع غير موجودة'});
      if (local.provider !== 'shamcash') return res.status(400).json({error: 'عملية الدفع ليست عبر شام كاش'});
      if (local.status === 'paid') return res.json({ok:true, status:'paid', already:true});
      if (local.status !== 'pending') return res.status(409).json({error: 'لا يمكن اعتماد عملية دفع ملغاة أو منتهية.'});
      const tx = String(req.body?.transaction_id || '').trim();
      if (!/^\d{3,30}$/.test(tx)) return res.status(400).json({error: 'أدخل رقم عملية شام كاش الصحيح'});
      if (!isConfigured(env)) throw new PaymentError(503, 'الدفع عبر شام كاش غير مفعّل حالياً. لا تحوّل أي مبلغ.');
      const remote = await lookup(tx, {env});
      const transaction = verifiedTransaction(remote, local, tx, String(env.SHAM_CASH_ACCOUNT_ADDRESS).trim());
      if (!transaction) return res.json({ok:false, status:'not_found', message:'لم يتم العثور على العملية بعد. تأكد من رقم العملية ثم حاول مجدداً.'});
      return res.json(await finalizePaidPayment(local.id, tx, transaction));
    } catch (error) {
      const conflict = ['provider_payment_already_used', 'payment_not_pending', 'wallet_currency_mismatch'].includes(error.message);
      res.status(error.status || (conflict ? 409 : 500)).json({error: error.status ? error.message : conflict ? 'لا يمكن اعتماد التحويل: تحقق من عدم استخدامه سابقاً ومن حالة العملية وعملة المحفظة.' : 'تعذر التحقق من عملية شام كاش. لم تُحتسب الدفعة.'});
    }
  });
}
module.exports = {isConfigured, findTransaction, verifiedTransaction, register};
