import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { signSession, setSessionCookie } from '../../lib/auth';
import { applyCors } from '../../lib/cors';

// Rate limiter en mémoire (par instance Vercel)
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = attempts.get(ip);
  
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }
  
  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  
  entry.count++;
  return { allowed: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const rl = checkRateLimit(ip);
  
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Trop de tentatives. Veuillez réessayer plus tard.' });
  }

  const { email, password } = req.body || {};
  
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }
  
  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Format d\'email invalide.' });
  }

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });
  
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes('not confirmed')) {
      return res.status(401).json({ error: "Votre email n'est pas encore confirmé." });
    }
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
