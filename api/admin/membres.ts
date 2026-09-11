import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default requireAdmin(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ members: data });
});