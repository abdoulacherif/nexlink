import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../lib/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';

function genReferralCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default requireAuth(async (req, res, session) => {
  if (req.method === 'GET') {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('user_id', session.userId)
      .maybeSingle();

    const results = await Promise.allSettled([
      supabaseAdmin.from('referral_earnings').select('*').eq('referrer_id', session.userId).order('created_at', { ascending: false }),
      supabaseAdmin.from('payments').select('*').eq('user_id', session.userId).order('created_at', { ascending: false }),
      supabaseAdmin.from('withdrawal_requests').select('*').eq('user_id', session.userId).order('created_at', { ascending: false }),
      supabaseAdmin.from('subscription_requests').select('*').eq('user_id', session.userId).order('created_at', { ascending: false }),
      supabaseAdmin.from('server_orders').select('*').eq('user_id', session.userId).order('created_at', { ascending: false }),
      supabaseAdmin.from('business_orders').select('*').eq('user_id', session.userId).order('created_at', { ascending: false }),
    ]);
    const pick = (r: PromiseSettledResult<any>) => (r.status === 'fulfilled' ? r.value.data || [] : []);

    return res.status(200).json({
      profile,
      earnings: pick(results[0]),
      payments: pick(results[1]),
      withdrawals: pick(results[2]),
      subscriptions: pick(results[3]),
      serverOrders: pick(results[4]),
      bizOrders: pick(results[5]),
    });
  }

  if (req.method === 'POST') {
    const { nom, whatsapp, pays, ville, business, secteur } = req.body || {};
    if (!nom || !whatsapp || !pays || !ville || !business || !secteur) {
      return res.status(400).json({ error: 'Merci de remplir tous les champs.' });
    }
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .insert({
        user_id: session.userId,
        email: session.email,
        nom, whatsapp, pays, ville, business, secteur,
        referral_code: genReferralCode(),
      })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ profile: data });
  }

  if (req.method === 'PATCH') {
    const { nom, whatsapp, ville, pays, business, secteur } = req.body || {};
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ nom, whatsapp, ville, pays, business, secteur })
      .eq('user_id', session.userId);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PUT') {
    // Changement de mot de passe
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(session.userId, { password });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    // Supprime la fiche de l'annuaire (garde le compte de connexion)
    const { error } = await supabaseAdmin.from('profiles').delete().eq('user_id', session.userId);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
});
