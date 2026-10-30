import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { sendConfirmationEmail } from '../../lib/mailer';
import { applyCors } from '../../lib/cors';

function genReferralCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const SITE_URL = process.env.SITE_URL || 'https://kontaks.vercel.app';

function sanitize(str: string): string {
  return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { name, phone, email, password, country, city, business, sector, referredBy } = req.body || {};

  if (!name || !phone || !email || !password || !country || !city || !business || !sector) {
    return res.status(400).json({ error: 'Merci de remplir tous les champs.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Format d\'email invalide.' });
  }

  const cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.length < 8 || cleanPhone.length > 15) {
    return res.status(400).json({ error: 'Numéro WhatsApp invalide.' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'signup',
    email: cleanEmail,
    password: String(password),
    options: { redirectTo: `${SITE_URL}/confirmation` },
  });

  if (linkError || !data.user) {
    return res.status(400).json({ error: linkError?.message || 'Impossible de créer le compte.' });
  }

  const userId = data.user.id;
  const actionLink = data.properties?.action_link;

  const { error: insertError } = await supabaseAdmin.from('profiles').insert({
    user_id: userId,
    nom: sanitize(String(name)),
    whatsapp: cleanPhone,
    email: cleanEmail,
    pays: sanitize(String(country)),
    ville: sanitize(String(city)),
    business: sanitize(String(business)),
    secteur: sanitize(String(sector)),
    referral_code: genReferralCode(),
    referred_by: referredBy ? sanitize(String(referredBy)) : null,
  });

  if (insertError) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return res.status(400).json({ error: insertError.message });
  }

  // Créditer le parrain (5 crédits) si un code de parrainage a été fourni
  if (referredBy) {
    Promise.resolve(
      supabaseAdmin.rpc('reward_referrer', {
        p_referral_code: sanitize(String(referredBy)),
        p_new_user_email: cleanEmail,
      })
    ).then(() => {}, (err) => {
      console.error('[signup] reward_referrer:', err);
    });
  }

  if (actionLink) {
    sendConfirmationEmail(name, cleanEmail, actionLink).catch(() => {});
  }

  return res.status(200).json({ ok: true, pendingConfirmation: true });
}
