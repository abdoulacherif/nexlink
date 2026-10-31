import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { applyCors } from '../../lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  return requireAuth(async (req, res, session) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

    const { targetUserId } = req.body || {};
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId requis.' });

    const { data, error } = await supabaseAdmin.rpc('check_mutual_save', {
      p_saver: session.userId,
      p_target: targetUserId,
    });

    if (error) {
      console.error('[save-contact]', error.message);
      return res.status(400).json({ error: 'Erreur lors de la vérification.' });
    }

    return res.status(200).json(data);
  })(req, res);
}
