import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { sendWelcomeEmail, sendAdminNotifEmail } from '../../lib/mailer';

function genReferralCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default requireAuth(async (req, res, session) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { nom, whatsapp, pays, ville, business, secteur } = req.body || {};
  if (!nom || !whatsapp || !pays || !ville || !business || !secteur) {
    return res.status(400).json({ error: 'Merci de remplir tous les champs.' });
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .insert({
      user_id: session.userId,
      email: session.email,
      nom,
      whatsapp,
      pays,
      ville,
      business,
      secteur,
      referral_code: genReferralCode(),
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  Promise.allSettled([
    sendWelcomeEmail(nom, session.email),
    sendAdminNotifEmail(nom, session.email, whatsapp),
  ]).catch(() => {});

  return res.status(200).json({ profile: data });
});
