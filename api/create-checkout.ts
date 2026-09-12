import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSession } from '../lib/auth';

// Crée une session de paiement LeekPay. La clé secrète ne quitte jamais le serveur.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });

  const { amount, description, metadata } = req.body || {};
  if (!amount || !description || !metadata || !metadata.kind) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  try {
    const resp = await fetch('https://leekpay.fr/api/v1/checkout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.LEEKPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        currency: 'XOF',
        description,
        return_url: 'https://kontaks.vercel.app/abonnement?paid=1',
        cancel_url: 'https://kontaks.vercel.app/abonnement',
        customer_email: session.email || undefined,
        // user_id vient TOUJOURS de la session serveur, jamais du client,
        // pour empêcher de créditer le compte de quelqu'un d'autre.
        metadata: { ...metadata, user_id: session.userId },
      }),
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      return res.status(400).json({ error: (data && data.message) || 'Erreur lors de la création du paiement' });
    }

    return res.status(200).json({
      payment_url: data.data.payment_url,
      checkout_id: data.data.id,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
