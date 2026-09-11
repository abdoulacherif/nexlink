import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearSessionCookie } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}