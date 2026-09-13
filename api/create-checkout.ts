import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Readable } from 'node:stream';
import crypto from 'crypto';
import { getSession } from '../lib/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';

// Ce fichier gère TROIS choses pour ne pas dépasser la limite de 12 fonctions
// serverless du plan Vercel Hobby :
//  1. POST (sans domaine perso pour l'instant) — création d'un paiement LeekPay
//  2. GET  — polling : le client revient de la page de paiement et demande
//            "est-ce que mon dernier paiement est passé ?" (obligatoire tant
//            qu'aucun webhook n'est configuré côté LeekPay)
//  3. POST avec header X-LeekPay-Signature — webhook, prêt pour quand le
//            domaine sera acheté et le webhook configuré ; peut cohabiter
//            avec le polling sans risque (les deux vérifient si le paiement
//            est déjà confirmé avant de créditer, donc jamais de double-crédit)
//
// Body parsing désactivé : la signature du webhook se vérifie sur le corps
// BRUT de la requête, pas sur du JSON reparsé.
export const config = {
  api: { bodyParser: false },
};

async function getRawBody(readable: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Applique le crédit correspondant au type de paiement — utilisé à la fois
// par le polling et par le webhook, jamais deux fois pour le même paiement.
async function applyPaymentCredit(userId: string, metadata: any, amount: number) {
  if (metadata.kind === 'credits') {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('credits')
      .eq('user_id', userId)
      .maybeSingle();
    const newCredits = (profile?.credits || 0) + (metadata.credits || 0);
    await supabaseAdmin.from('profiles').update({ credits: newCredits }).eq('user_id', userId);
  }

  if (metadata.kind === 'subscription') {
    await supabaseAdmin.from('subscription_requests').insert({
      user_id: userId,
      plan_id: metadata.plan_id,
      plan_name: metadata.plan_name,
      price: amount,
      status: 'payé',
    });
  }

  if (metadata.kind === 'cagnotte') {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('credits')
      .eq('user_id', userId)
      .maybeSingle();
    const newCredits = (profile?.credits || 0) + (metadata.credits_reward || 0);
    await supabaseAdmin.from('profiles').update({ credits: newCredits }).eq('user_id', userId);

    await supabaseAdmin.from('cagnotte_entries').insert({
      campaign_id: metadata.campaign_id,
      user_id: userId,
    });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // =================================================================
  // GET — Polling : "mon dernier paiement en attente est-il passé ?"
  // =================================================================
  if (req.method === 'GET') {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Non authentifié' });

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('user_id', session.userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!payment) return res.status(200).json({ status: null });

    try {
      const resp = await fetch(`https://leekpay.fr/api/v1/checkout/${payment.checkout_id}`, {
        headers: { Authorization: `Bearer ${process.env.LEEKPAY_SECRET_KEY}` },
      });
      const data = await resp.json();
      const remoteStatus = data?.data?.status;

      if (remoteStatus === 'paid') {
        await applyPaymentCredit(session.userId, payment.metadata, payment.amount);
        await supabaseAdmin.from('payments').update({ status: 'confirmé' }).eq('id', payment.id);
        return res.status(200).json({ status: 'paid' });
      }

      if (['failed', 'cancelled', 'expired'].includes(remoteStatus)) {
        await supabaseAdmin.from('payments').update({ status: remoteStatus }).eq('id', payment.id);
        return res.status(200).json({ status: remoteStatus });
      }

      return res.status(200).json({ status: 'pending' });
    } catch (err: any) {
      return res.status(200).json({ status: 'pending' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-leekpay-signature'] as string | undefined;

  // =================================================================
  // POST avec signature — Webhook LeekPay (prêt pour plus tard)
  // =================================================================
  if (signature) {
    const expected = crypto
      .createHmac('sha256', process.env.LEEKPAY_PUBLIC_KEY || '')
      .update(rawBody)
      .digest('hex');

    let valid = false;
    try {
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      valid = false;
    }
    if (!valid) return res.status(401).json({ error: 'Signature invalide' });

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'JSON invalide' });
    }

    const { event, data } = payload || {};
    if (event !== 'payment.completed' || !data || data.status !== 'paid') {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const metadata = data.metadata || {};
    const userId = metadata.user_id;
    if (!userId) return res.status(200).json({ ok: true, ignored: true });

    const { data: existing } = await supabaseAdmin
      .from('payments')
      .select('id, status')
      .eq('checkout_id', data.checkout_id)
      .maybeSingle();

    if (existing?.status === 'confirmé') {
      return res.status(200).json({ ok: true, alreadyProcessed: true });
    }

    try {
      await applyPaymentCredit(userId, metadata, data.amount);
      if (existing) {
        await supabaseAdmin.from('payments').update({ status: 'confirmé' }).eq('id', existing.id);
      } else {
        await supabaseAdmin.from('payments').insert({
          user_id: userId,
          checkout_id: data.checkout_id,
          kind: metadata.kind,
          amount: data.amount,
          metadata,
          status: 'confirmé',
        });
      }
    } catch (err) {
      console.error('Erreur traitement webhook LeekPay:', err);
    }

    return res.status(200).json({ ok: true });
  }

  // =================================================================
  // POST sans signature — Création d'un paiement (depuis nos pages)
  // =================================================================
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });

  let body: any;
  try {
    body = JSON.parse(rawBody.toString('utf8') || '{}');
  } catch {
    return res.status(400).json({ error: 'JSON invalide' });
  }

  const { amount, description, metadata, returnPath } = body || {};
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
        return_url: `https://kontaks.vercel.app/${returnPath || 'abonnement'}?paid=1`,
        cancel_url: `https://kontaks.vercel.app/${returnPath || 'abonnement'}`,
        customer_email: session.email || undefined,
        metadata: { ...metadata, user_id: session.userId },
      }),
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      return res.status(400).json({ error: (data && data.message) || 'Erreur lors de la création du paiement' });
    }

    // On enregistre le paiement en attente pour pouvoir le confirmer par
    // polling au retour du client (tant qu'il n'y a pas de webhook).
    await supabaseAdmin.from('payments').insert({
      user_id: session.userId,
      checkout_id: data.data.id,
      kind: metadata.kind,
      amount,
      metadata,
      status: 'pending',
    });

    return res.status(200).json({
      payment_url: data.data.payment_url,
      checkout_id: data.data.id,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
