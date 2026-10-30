import jwt from 'jsonwebtoken';
import { serialize, parse } from 'cookie';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './supabaseAdmin';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET manquant.');

const COOKIE_NAME = 'kontak_session';
const MAX_AGE = 60 * 60 * 24 * 7;

export interface SessionPayload { userId: string; email: string; isAdmin: boolean; }

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: MAX_AGE });
}

export function setSessionCookie(res: VercelResponse, token: string) {
  // On détecte si la requête vient de l'application mobile via le header Origin
  const origin = res.req?.headers?.origin || '';
  const isMobileApp = origin.includes('localhost') || origin.includes('capacitor');

  res.setHeader('Set-Cookie', serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    // CRUCIAL : L'app mobile exige SameSite=None, le web peut garder Lax
    sameSite: isMobileApp ? 'none' : 'lax',
    path: '/',
    maxAge: MAX_AGE,
  }));
}

export function clearSessionCookie(res: VercelResponse) {
  res.setHeader('Set-Cookie', serialize(COOKIE_NAME, '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
  }));
}

export function getSession(req: VercelRequest): SessionPayload | null {
  const cookies = parse(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET as string) as SessionPayload; } catch { return null; }
}

type Handler = (req: VercelRequest, res: VercelResponse, session: SessionPayload) => Promise<void | VercelResponse> | void | VercelResponse;

export function requireAuth(handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const raw = getSession(req);
    if (!raw) { res.status(401).json({ error: 'Non authentifié' }); return; }
    const session = { userId: raw.userId, email: raw.email, isAdmin: raw.isAdmin };
    return handler(req, res, session);
  };
}

export function requireAdmin(handler: Handler) {
  return requireAuth(async (req, res, session) => {
    if (!session.isAdmin) { res.status(403).json({ error: 'Accès réservé aux administrateurs' }); return; }
    return handler(req, res, session);
  });
}
