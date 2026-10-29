import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default requireAuth(async (req, res, session) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { planId } = req.body || {};
  if (!planId) return res.status(400).json({ error: 'planId requis' });

  const { data, error } = await supabaseAdmin.rpc('pay_plan_with_solde', {
    p_user_id: session.userId,
    p_plan_id: planId,
  });

  if (error) {
    console.error('[subscriptions/create]', error.message);
    return res.status(400).json({ error: 'Erreur lors du paiement.' });
  }

  const result = data as { ok: boolean; paid?: boolean; solde?: number; error?: string };

  if (!result.ok) {
    if (result.paid === false) {
      const { data: plan } = await supabaseAdmin
        .from('subscription_plans')
        .select('*')
        .eq('id', planId)
        .eq('active', true)
        .maybeSingle();
      return res.status(200).json({ paid: false, plan });
    }
    return res.status(400).json({ error: result.error });
  }

  return res.status(200).json({ 
    paid: true, 
    method: 'solde', 
    solde: result.solde 
  });
});
