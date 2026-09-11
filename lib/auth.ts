import jwt from 'jsonwebtoken';
import { serialize, parse } from 'cookie';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const JWT_SECRET = process.env.JWT_SECRET!;
const COOKIE_NAME = 'kontak_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 jours

export interface SessionPayload {
  userId: string;
  email: string;
  isAdmin: boolean;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: MAX_AGE });
}

export function setSessionCookie(res: VercelResponse, token: string) {
  res.setHeader(
    'Set-Cookie',
    serialize(COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: MAX_AGE,
    })
  );
}

export function clearSessionCookie(res: VercelResponse) {
  res.setHeader(
    'Set-Cookie',
    serialize(COOKIE_NAME, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
  );
}

export function getSession(req: VercelRequest): SessionPayload | null {
  const cookies = parse(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

// Protège une route : utilisateur connecté requis
export function requireAuth(
  handler: (req: VercelRequest, res: VercelResponse, session: SessionPayload) => Promise<void> | void
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: 'Non authentifié' });
      return;
    }
    return handler(req, res, session);
  };
}

// Protège une route : admin requis
export function requireAdmin(
  handler: (req: VercelRequest, res: VercelResponse, session: SessionPayload) => Promise<void> | void
) {
  return requireAuth(async (req, res, session) => {
    if (!session.isAdmin) {
      res.status(403).json({ error: 'Accès réservé aux administrateurs' });
      return;
    }
    return handler(req, res, session);
  });
}
