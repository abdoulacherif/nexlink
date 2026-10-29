import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { slug, id } = req.query;

  if (!slug && !id) {
    return res.status(400).json({ error: 'Paramètre slug ou id requis.' });
  }

  const publicFields = 'nom, business, ville, pays, secteur, whatsapp, description, avatar_url, slug, created_at';

  let query = supabaseAdmin.from('profiles').select(publicFields);

  if (slug) {
    query = query.eq('slug', String(slug).toLowerCase());
  } else {
    query = query.eq('user_id', String(id));
  }

  const { data: profile, error } = await query.maybeSingle();

  if (error) {
    console.error('[profiles/public]', error.message);
    return res.status(400).json({ error: 'Erreur de lecture.' });
  }

  if (!profile) {
    return res.status(404).json({ error: 'Fiche introuvable.' });
  }

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  return res.status(200).json({ profile });
}
