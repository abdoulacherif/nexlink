import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { signSession, setSessionCookie } from '../../lib/auth';
import { sendWelcomeEmail, sendAdminNotifEmail } from '../../lib/mailer';

function genReferralCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { name, phone, email, password, country, city, business, sector, referredBy } = req.body || {};

  if (!name || !phone || !email || !password || !country || !city || !business || !sector) {
    return res.status(400).json({ error: 'Merci de remplir tous les champs.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    return res.status(400).json({ error: authError?.message || 'Impossible de créer le compte.' });
  }

  const userId = authData.user.id;

  const { error: insertError } = await supabaseAdmin.from('profiles').insert({
    user_id: userId,
    nom: name,
    whatsapp: phone,
    email,
    pays: country,
    ville: city,
    business,
    secteur: sector,
    referral_code: genReferralCode(),
    referred_by: referredBy || null,
  });

  if (insertError) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return res.status(400).json({ error: insertError.message });
  }

  const token = signSession({ userId, email, isAdmin: false });
  setSessionCookie(res, token);

  Promise.allSettled([sendWelcomeEmail(name, email), sendAdminNotifEmail(name, email, phone)]).catch(() => {});

  return res.status(200).json({ ok: true });
}
