import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSession } from '../lib/auth';

// TODO: cette route est un squelette. Je n'ai pas la documentation de l'API
// LeekPay (endpoint de création de checkout, format exact du payload et de
// la réponse), donc je ne peux pas deviner ça sans risquer de casser le
// paiement en prod. Remplace le bloc "fetch(...)" ci-dessous par le vrai
// appel LeekPay une fois que tu as leur doc API sous la main — la structure
// générale (vérifier l'auth, créer le paiement, renvoyer payment_url) reste
// correcte.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });

  const { amount, description, metadata } = req.body || {};
  if (!amount || !description) {
    return res.status(400).json({ error: 'amount et description requis' });
  }

  try {
    // --- À REMPLACER par le vrai appel LeekPay ---
    // const resp = await fetch('https://api.leekpay.example/v1/checkout', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${process.env.LEEKPAY_SECRET_KEY}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     amount,
    //     description,
    //     metadata: { ...metadata, user_id: session.userId },
    //     success_url: `${process.env.SITE_URL}/dashboard`,
    //     cancel_url: `${process.env.SITE_URL}/abonnement`,
    //   }),
    // });
    // const data = await resp.json();
    // return res.status(200).json({ payment_url: data.checkout_url });

    return res.status(501).json({ error: "Paiement LeekPay pas encore branché côté serveur." });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur lors de la création du paiement.' });
  }
}
