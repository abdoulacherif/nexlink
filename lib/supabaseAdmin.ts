import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY manquantes.');
}

// Client admin : contourne les RLS, ne doit JAMAIS être exposé au frontend.
// Toute la logique d'autorisation doit être faite ici, côté backend.
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});