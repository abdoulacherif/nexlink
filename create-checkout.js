// Fonction serveur Vercel — crée une session de paiement LeekPay.
// La clé secrète ne quitte jamais le serveur.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { amount, description, customer_email, customer_name, metadata } = req.body;

    if (!amount || !description || !metadata || !metadata.user_id || !metadata.kind) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    const resp = await fetch('https://leekpay.fr/api/v1/checkout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LEEKPAY_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount,
        currency: 'XOF',
        description,
        return_url: 'https://kontaks.vercel.app/abonnement?paid=1',
        cancel_url: 'https://kontaks.vercel.app/abonnement',
        customer_email: customer_email || undefined,
        customer_name: customer_name || undefined,
        metadata
      })
    });

    const data = await resp.json();

    if (!resp.ok || !data.success) {
      return res.status(400).json({ error: (data && data.message) || 'Erreur lors de la création du paiement' });
    }

    return res.status(200).json({
      payment_url: data.data.payment_url,
      checkout_id: data.data.id
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
