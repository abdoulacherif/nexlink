import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { city, sector, q } = req.query;

  let query = supabaseAdmin
    .from('profiles')
    .select('nom, ville, pays, business, secteur, whatsapp, user_id');

  if (city) query = query.ilike('ville', `%${city}%`);
  if (sector) query = query.eq('secteur', sector as string);
  if (q) query = query.or(`nom.ilike.%${q}%,business.ilike.%${q}%`);

  const { data, error } = await query.limit(100);
  if (error) return res.status(400).json({ error: error.message });

  return res.status(200).json({ profiles: data });
}