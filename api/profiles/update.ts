import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default requireAuth(async (req, res, session) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { nom, whatsapp, ville, pays, business, secteur } = req.body || {};

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ nom, whatsapp, ville, pays, business, secteur })
    .eq('user_id', session.userId);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ ok: true });
});