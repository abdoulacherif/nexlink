import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

// Route admin unique, multi-ressources via ?resource=
// Ressources prévues : profiles, nav-items, withdrawals, subscriptions,
// plans, server-offers, server-orders, biz-services, biz-orders
// (ajoutées au fur et à mesure des 6 pages admin, pour ne pas dépasser
// la limite de 12 fonctions serverless du plan Vercel Hobby).

const COMMISSION_CAP_PER_FILLEUL = 5000; // FCFA à vie, par filleul

export default requireAdmin(async (req, res) => {
  const resource = (req.query.resource as string) || 'profiles';

  // ---------------------------------------------------------------
  // FICHES (profiles)
  // ---------------------------------------------------------------
  if (resource === 'profiles') {
    if (req.method === 'GET') {
      const q = (req.query.q as string) || '';
      const offset = parseInt((req.query.offset as string) || '0', 10) || 0;
      const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 100);

      let query = supabaseAdmin.from('profiles').select('*', { count: 'exact' });
      if (q) {
        const safe = q.replace(/[%,]/g, '');
        query = query.or(
          `nom.ilike.%${safe}%,business.ilike.%${safe}%,whatsapp.ilike.%${safe}%,email.ilike.%${safe}%,ville.ilike.%${safe}%`
        );
      }
      query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ profiles: data, total: count ?? 0 });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      // Attribution de commission de parrainage
      if (action === 'grant-commission') {
        const { referredBy, sourceName, sourceUserId, sourceEmail, sourceWhatsapp, amount } = req.body || {};
        const purchase = parseFloat(amount);
        if (!purchase || purchase <= 0) return res.status(400).json({ error: 'Montant invalide.' });

        const { data: referrer, error: findErr } = await supabaseAdmin
          .from('profiles')
          .select('user_id, solde, email, whatsapp')
          .eq('referral_code', referredBy)
          .maybeSingle();
        if (findErr) return res.status(400).json({ error: findErr.message });
        if (!referrer) return res.status(404).json({ error: 'Parrain introuvable pour ce code.' });

        const referrerEmail = (referrer.email || '').toLowerCase();
        const srcEmail = (sourceEmail || '').toLowerCase();
        if ((srcEmail && srcEmail === referrerEmail) || (sourceWhatsapp && sourceWhatsapp === referrer.whatsapp)) {
          return res.status(400).json({ error: 'Auto-parrainage détecté — commission refusée.' });
        }

        const commission = Math.round(purchase * 0.1);

        if (sourceUserId) {
          const { data: earnings, error: earnErr } = await supabaseAdmin
            .from('referral_earnings')
            .select('amount')
            .eq('referrer_id', referrer.user_id)
            .eq('source_user_id', sourceUserId);
          if (earnErr) return res.status(400).json({ error: earnErr.message });
          const already = (earnings || []).reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
          if (already + commission > COMMISSION_CAP_PER_FILLEUL) {
            const remaining = Math.max(0, COMMISSION_CAP_PER_FILLEUL - already);
            return res.status(400).json({
              error: `Plafond atteint pour ce filleul (${already}/${COMMISSION_CAP_PER_FILLEUL} FCFA). Marge restante : ${remaining} FCFA.`,
            });
          }
        }

        const { error: updErr } = await supabaseAdmin
          .from('profiles')
          .update({ solde: (referrer.solde || 0) + commission })
          .eq('user_id', referrer.user_id);
        if (updErr) return res.status(400).json({ error: updErr.message });

        await supabaseAdmin.from('referral_earnings').insert({
          referrer_id: referrer.user_id,
          source_name: sourceName,
          source_user_id: sourceUserId || null,
          amount: commission,
        });

        return res.status(200).json({ ok: true, commission });
      }

      // Création d'une fiche
      const payload = req.body || {};
      delete payload.action;
      const { error } = await supabaseAdmin.from('profiles').insert(payload);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('profiles').update(req.body || {}).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('profiles').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // ---------------------------------------------------------------
  // BARRE DE NAVIGATION (nav_items)
  // ---------------------------------------------------------------
  if (resource === 'nav-items') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('nav_items')
        .select('*')
        .order('position', { ascending: true });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ items: data });
    }

    if (req.method === 'POST') {
      const { error } = await supabaseAdmin.from('nav_items').insert(req.body || {});
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('nav_items').update(req.body || {}).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('nav_items').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  return res.status(400).json({ error: `Ressource inconnue : ${resource}` });
});