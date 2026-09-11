import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSession, clearSessionCookie } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'DELETE') {
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
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