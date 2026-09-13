import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSession, signSession, setSessionCookie, clearSessionCookie } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { sendWelcomeEmail, sendAdminNotifEmail } from '../../lib/mailer';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'DELETE') {
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST') {
    // Appelé par confirmation.html juste après que Supabase ait validé le
    // lien de vérification email et créé une session Supabase côté client.
    // On échange cet access_token contre NOTRE session (cookie signé).
    const { access_token } = req.body || {};
    if (!access_token) return res.status(400).json({ error: 'access_token requis' });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(access_token);
    if (userErr || !userData.user) {
      return res.status(401).json({ error: 'Lien de confirmation invalide ou expiré.' });
    }

    const authUser = userData.user;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('user_id', authUser.id)
      .maybeSingle();

    const token = signSession({
      userId: authUser.id,
      email: authUser.email || '',
      isAdmin: !!profile?.is_admin,
    });
    setSessionCookie(res, token);

    // Envoi des emails de bienvenue, maintenant que le compte est confirmé
    if (profile) {
      Promise.allSettled([
        sendWelcomeEmail(profile.nom, authUser.email || ''),
        sendAdminNotifEmail(profile.nom, authUser.email || '', profile.whatsapp),
      ]).catch(() => {});
    }

    return res.status(200).json({ ok: true, isAdmin: !!profile?.is_admin });
  }

  const session = getSession(req);
  if (!session) return res.status(200).json({ user: null });

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('user_id', session.userId)
    .maybeSingle();

  return res.status(200).json({ user: { ...session, profile } });
}
