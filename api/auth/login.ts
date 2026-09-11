import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { signSession, setSessionCookie } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('user_id', data.user.id)
    .maybeSingle();

  const token = signSession({
    userId: data.user.id,
    email: data.user.email!,
    isAdmin: !!profile?.is_admin,
  });
  setSessionCookie(res, token);

  return res.status(200).json({ ok: true, isAdmin: !!profile?.is_admin });
}