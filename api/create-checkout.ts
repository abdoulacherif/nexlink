import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Readable } from 'node:stream';
import crypto from 'crypto';
import { getSession } from '../lib/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';

// Ce fichier gère DEUX choses pour ne pas dépasser la limite de 12 fonctions
// serverless du plan Vercel Hobby :
//  1. La création d'un paiement LeekPay (appelée depuis nos pages)
//  2. Le webhook LeekPay qui confirme qu'un paiement a réellement abouti
// On les distingue par la présence du header X-LeekPay-Signature.
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-leekpay-signature'] as string | undefined;

  // =================================================================
  // CAS 1 — Webhook LeekPay : confirmation réelle d'un paiement
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

    // On accuse toujours réception (200) même si on ignore l'événement,
    // sinon LeekPay va continuer à réessayer indéfiniment.
    if (event !== 'payment.completed' || !data || data.status !== 'paid') {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const metadata = data.metadata || {};
    const userId = metadata.user_id;
    if (!userId) return res.status(200).json({ ok: true, ignored: true });

    try {
      if (metadata.kind === 'credits') {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('credits')
          .eq('user_id', userId)
          .maybeSingle();
        const newCredits = (profile?.credits || 0) + (metadata.credits || 0);
        await supabaseAdmin.from('profiles').update({ credits: newCredits }).eq('user_id', userId);

        await supabaseAdmin.from('payments').insert({
          user_id: userId,
          kind: 'credits',
          amount: data.amount,
          status: 'confirmé',
        });
      }

      if (metadata.kind === 'subscription') {
        await supabaseAdmin.from('subscription_requests').insert({
          user_id: userId,
          plan_id: metadata.plan_id,
          plan_name: metadata.plan_name,
          price: data.amount,
          status: 'payé',
        });

        await supabaseAdmin.from('payments').insert({
          user_id: userId,
          kind: 'subscription',
          amount: data.amount,
          status: 'confirmé',
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
    } catch (err) {
      // On logue l'erreur mais on renvoie quand même 200 : le paiement a
      // réellement eu lieu chez LeekPay, ce n'est pas à eux de réessayer
      // indéfiniment à cause d'un bug de notre côté — on corrige à la main.
      console.error('Erreur traitement webhook LeekPay:', err);
    }

    return res.status(200).json({ ok: true });
  }

  // =================================================================
  // CAS 2 — Création d'un paiement (appelée depuis nos pages)
  // =================================================================
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });

  let body: any;
  try {
    body = JSON.parse(rawBody.toString('utf8') || '{}');
  } catch {
    return res.status(400).json({ error: 'JSON invalide' });
  }

  const { amount, description, metadata } = body || {};
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
