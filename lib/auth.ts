import jwt from 'jsonwebtoken';
import { serialize, parse } from 'cookie';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from './supabaseAdmin';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET manquant dans les variables d\'environnement.');
}

const COOKIE_NAME = 'kontak_session';
const MAX_AGE = 60 * 60 * 24 * 7;

export interface SessionPayload {
  userId: string;
  email: string;
  isAdmin: boolean;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: MAX_AGE });
}

export function setSessionCookie(res: VercelResponse, token: string) {
  res.setHeader('Set-Cookie', serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  }));
}

export function clearSessionCookie(res: VercelResponse) {
  res.setHeader('Set-Cookie', serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  }));
}

export function getSession(req: VercelRequest): SessionPayload | null {
  const cookies = parse(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET as string) as SessionPayload;
  } catch {
    return null;
  }
}

type Handler = (
  req: VercelRequest,
  res: VercelResponse,
  session: SessionPayload
) => Promise<void | VercelResponse> | void | VercelResponse;

async function verifyUserStillValid(session: SessionPayload): Promise<SessionPayload | null> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('user_id', session.userId)
    .maybeSingle();

  return {
    userId: session.userId,
    email: session.email,
    isAdmin: !!(profile?.is_admin),
  };
}

export function requireAuth(handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const raw = getSession(req);
    if (!raw) {
      res.status(401).json({ error: 'Non authentifié' });
      return;
    }
    const session = await verifyUserStillValid(raw);
    if (!session) {
      clearSessionCookie(res);
      res.status(401).json({ error: 'Session expirée' });
      return;
    }
    return handler(req, res, session);
  };
}

export function requireAdmin(handler: Handler) {
  return requireAuth(async (req, res, session) => {
    if (!session.isAdmin) {
      res.status(403).json({ error: 'Accès réservé aux administrateurs' });
      return;
    }
    return handler(req, res, session);
  });
}
