import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../lib/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';

function genReferralCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default requireAuth(async (req, res, session) => {
  if (req.method === 'PATCH') {
    const { nom, whatsapp, ville, pays, business, secteur } = req.body || {};
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ nom, whatsapp, ville, pays, business, secteur })
      .eq('user_id', session.userId);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
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

  return res.status(405).json({ error: 'Méthode non autorisée' });
});