import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default requireAuth(async (req, res, session) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { amount, method, details } = req.body || {};
  const amt = parseInt(amount, 10);

  if (!amt || amt <= 0 || !method || !details) {
    return res.status(400).json({ error: 'Merci de remplir tous les champs.' });
  }

  const { data, error } = await supabaseAdmin.rpc('request_withdrawal', {
    p_user_id: session.userId,
    p_amount: amt,
    p_method: method,
    p_details: details,
  });

  if (error) {
    console.error('[withdrawals/create]', error.message);
    return res.status(400).json({ error: 'Erreur lors de la demande de retrait.' });
  }

  const result = data as { ok: boolean; solde?: number; error?: string; request_id?: string };

  if (!result.ok) {
    return res.status(400).json({ error: result.error || 'Solde insuffisant.' });
  }

  return res.status(200).json({
    ok: true,
    solde: result.solde,
    requestId: result.request_id
  });
});
