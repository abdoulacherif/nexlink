// Fonction serveur Vercel — reçoit la confirmation de paiement de LeekPay,
// vérifie son authenticité, puis crédite automatiquement le compte concerné.
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function supabaseCall(path, body) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-leekpay-signature'];

  const expected = crypto
    .createHmac('sha256', process.env.LEEKPAY_PUBLIC_KEY)
    .update(rawBody)
    .digest('hex');

  if (!signature || expected !== signature) {
    return res.status(401).json({ error: 'Signature invalide' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Payload invalide' });
  }

  const { event, data } = payload;

  if (event === 'payment.completed' && data && data.status === 'paid') {
    const meta = data.metadata || {};

    // Journal de tous les paiements, pour historique/audit
    try {
      await supabaseCall('/rest/v1/payments', {
        transaction_id: data.transaction_id,
        user_id: meta.user_id || null,
        amount: data.amount,
        kind: meta.kind || 'inconnu',
        status: 'payé',
        raw: data
      });
    } catch (e) { /* le journal ne doit pas bloquer le crédit du compte */ }

    if (meta.kind === 'credits' && meta.user_id && meta.credits) {
      await supabaseCall('/rest/v1/rpc/add_credits', {
        target_user_id: meta.user_id,
        amount: parseInt(meta.credits, 10)
      });
    }

    if (meta.kind === 'subscription' && meta.user_id) {
      await supabaseCall('/rest/v1/subscription_requests', {
        user_id: meta.user_id,
        plan_id: meta.plan_id || null,
        plan_name: meta.plan_name || '',
        price: data.amount,
        status: 'payé'
      });
    }
  }

  return res.status(200).json({ received: true });
}
