import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default requireAuth(async (req, res, session) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { amount, method, details } = req.body || {};
  if (!amount || amount <= 0 || !method || !details) {
    return res.status(400).json({ error: 'Merci de remplir tous les champs.' });
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('solde')
    .eq('user_id', session.userId)
    .maybeSingle();

  const solde = profile?.solde || 0;
  if (amount > solde) {
    return res.status(400).json({ error: 'Le montant dépasse ton solde disponible.' });
  }

  const { error } = await supabaseAdmin.from('withdrawal_requests').insert({
    user_id: session.userId,
    amount,
    method,
    details,
    status: 'en attente',
  });

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ ok: true });
});
