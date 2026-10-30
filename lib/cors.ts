import type { VercelRequest, VercelResponse } from '@vercel/node';

export function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;
  
  // Autoriser l'app mobile (Capacitor) et le site web
  const allowedOrigins = [
    'https://localhost',
    'http://localhost',
    'capacitor://localhost',
    'https://kontaks.vercel.app',
    'http://kontaks.vercel.app'
  ];

  if (origin && (allowedOrigins.includes(origin) || origin.startsWith('http://localhost'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Gérer la requête "preflight" (OPTIONS) que le navigateur envoie avant la vraie requête
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // Signifie qu'on a géré la requête
  }
  
  return false; // Signifie qu'on peut continuer
}
