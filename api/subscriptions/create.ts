import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default requireAuth(async (req, res, session) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { planId } = req.body || {};
  if (!planId) return res.status(400).json({ error: 'planId requis' });

  const { data: plan, error: planErr } = await supabaseAdmin
    .from('subscription_plans')
    .select('*')
    .eq('id', planId)
    .eq('active', true)
    .maybeSingle();

  if (planErr || !plan) return res.status(404).json({ error: 'Forfait introuvable' });

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('solde')
    .eq('user_id', session.userId)
    .maybeSingle();

  const solde = profile?.solde || 0;

  if (solde >= plan.price) {
    const { error: updErr } = await supabaseAdmin
      .from('profiles')
      .update({ solde: solde - plan.price })
      .eq('user_id', session.userId);
    if (updErr) return res.status(400).json({ error: updErr.message });

    const { error: insErr } = await supabaseAdmin.from('subscription_requests').insert({
      user_id: session.userId,
      plan_id: plan.id,
      plan_name: plan.name,
      price: plan.price,
      status: 'payé',
    });
    if (insErr) return res.status(400).json({ error: insErr.message });

    return res.status(200).json({ paid: true, method: 'solde' });
  }

  // Solde insuffisant : le client doit lancer le paiement LeekPay avec ce forfait
  return res.status(200).json({ paid: false, plan });
});
