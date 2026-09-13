import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { sendConfirmationEmail } from '../../lib/mailer';

function genReferralCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const SITE_URL = 'https://kontaks.vercel.app';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { name, phone, email, password, country, city, business, sector, referredBy } = req.body || {};

  if (!name || !phone || !email || !password || !country || !city || !business || !sector) {
    return res.status(400).json({ error: 'Merci de remplir tous les champs.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  // Crée le compte NON confirmé et génère le lien de vérification en un seul appel
  const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'signup',
    email,
    password,
    options: { redirectTo: `${SITE_URL}/confirmation` },
  });

  if (linkError || !data.user) {
    return res.status(400).json({ error: linkError?.message || 'Impossible de créer le compte.' });
  }

  const userId = data.user.id;
  const actionLink = data.properties?.action_link;

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
    // Rollback : on supprime le compte auth si la création du profil échoue
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return res.status(400).json({ error: insertError.message });
  }

  if (actionLink) {
    sendConfirmationEmail(name, email, actionLink).catch(() => {});
  }

  return res.status(200).json({ ok: true, pendingConfirmation: true });
}
