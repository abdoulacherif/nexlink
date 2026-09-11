import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { data, error } = await supabaseAdmin
    .from('subscription_plans')
    .select('*')
    .eq('active', true)
    .order('position', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ plans: data });
}
