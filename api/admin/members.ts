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

  // ---------------------------------------------------------------
  // DEMANDES DE RETRAIT (withdrawal_requests)
  // ---------------------------------------------------------------
  if (resource === 'withdrawals') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('withdrawal_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ items: data });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('withdrawal_requests').update(req.body || {}).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('withdrawal_requests').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // ---------------------------------------------------------------
  // DEMANDES D'ABONNEMENT (subscription_requests)
  // ---------------------------------------------------------------
  if (resource === 'subscriptions') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('subscription_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ items: data });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('subscription_requests').update(req.body || {}).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('subscription_requests').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // ---------------------------------------------------------------
  // FORFAITS D'ABONNEMENT (subscription_plans)
  // ---------------------------------------------------------------
  if (resource === 'plans') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('subscription_plans')
        .select('*')
        .order('position', { ascending: true });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ items: data });
    }
    if (req.method === 'POST') {
      const { error } = await supabaseAdmin.from('subscription_plans').insert(req.body || {});
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('subscription_plans').update(req.body || {}).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('subscription_plans').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // ---------------------------------------------------------------
  // OFFRES SERVEUR (server_offers)
  // ---------------------------------------------------------------
  if (resource === 'server-offers') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('server_offers')
        .select('*')
        .order('position', { ascending: true });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ items: data });
    }
    if (req.method === 'POST') {
      const { error } = await supabaseAdmin.from('server_offers').insert(req.body || {});
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('server_offers').update(req.body || {}).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('server_offers').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // ---------------------------------------------------------------
  // DEMANDES SERVEUR (server_orders)
  // ---------------------------------------------------------------
  if (resource === 'server-orders') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('server_orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ items: data });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('server_orders').update(req.body || {}).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('server_orders').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // ---------------------------------------------------------------
  // SERVICES BUSINESS (business_services)
  // ---------------------------------------------------------------
  if (resource === 'biz-services') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('business_services')
        .select('*')
        .order('position', { ascending: true });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ items: data });
    }
    if (req.method === 'POST') {
      const { error } = await supabaseAdmin.from('business_services').insert(req.body || {});
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('business_services').update(req.body || {}).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('business_services').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // ---------------------------------------------------------------
  // DEMANDES BUSINESS (business_orders)
  // ---------------------------------------------------------------
  if (resource === 'biz-orders') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('business_orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ items: data });
    }
    if (req.method === 'PATCH') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('business_orders').update(req.body || {}).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('business_orders').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // ---------------------------------------------------------------
  // CAGNOTTES (cagnotte_campaigns + cagnotte_entries)
  // ---------------------------------------------------------------
  if (resource === 'cagnottes') {
    if (req.method === 'GET') {
      const { data: campaigns, error } = await supabaseAdmin
        .from('cagnotte_campaigns')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });

      // Nombre de participants par campagne
      const withCounts = await Promise.all(
        (campaigns || []).map(async (c: any) => {
          const { count } = await supabaseAdmin
            .from('cagnotte_entries')
            .select('*', { count: 'exact', head: true })
            .eq('campaign_id', c.id);
          return { ...c, entries_count: count ?? 0 };
        })
      );

      return res.status(200).json({ items: withCounts });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      // Déclenche le tirage au sort d'une campagne
      if (action === 'draw') {
        const { campaignId } = req.body || {};
        if (!campaignId) return res.status(400).json({ error: 'campaignId requis' });

        const { data: campaign, error: campErr } = await supabaseAdmin
          .from('cagnotte_campaigns')
          .select('*')
          .eq('id', campaignId)
          .maybeSingle();
        if (campErr || !campaign) return res.status(404).json({ error: 'Campagne introuvable.' });
        if (campaign.status === 'drawn') return res.status(400).json({ error: 'Le tirage a déjà eu lieu.' });

        const { data: entries, error: entErr } = await supabaseAdmin
          .from('cagnotte_entries')
          .select('*')
          .eq('campaign_id', campaignId);
        if (entErr) return res.status(400).json({ error: entErr.message });
        if (!entries || entries.length === 0) {
          return res.status(400).json({ error: 'Aucun participant pour cette campagne.' });
        }

        const winnersCount = Math.min(campaign.winners_count || 5, entries.length);
        const shuffled = [...entries].sort(() => Math.random() - 0.5);
        const winners = shuffled.slice(0, winnersCount);

        for (const w of winners) {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('solde')
            .eq('user_id', w.user_id)
            .maybeSingle();
          const solde = profile?.solde || 0;
          await supabaseAdmin
            .from('profiles')
            .update({ solde: solde + (campaign.prize_per_winner || 0) })
            .eq('user_id', w.user_id);
          await supabaseAdmin
            .from('cagnotte_entries')
            .update({ is_winner: true, amount_won: campaign.prize_per_winner })
            .eq('id', w.id);
        }

        await supabaseAdmin
          .from('cagnotte_campaigns')
          .update({ status: 'drawn', drawn_at: new Date().toISOString() })
          .eq('id', campaignId);

        return res.status(200).json({ ok: true, winnersCount, winners: winners.map((w: any) => w.user_id) });
      }

      // Création d'une nouvelle campagne
      const { name, entry_price, credits_reward, winners_count, prize_per_winner } = req.body || {};
      if (!name || !entry_price || !winners_count || !prize_per_winner) {
        return res.status(400).json({ error: 'Champs manquants.' });
      }
      const { error } = await supabaseAdmin.from('cagnotte_campaigns').insert({
        name,
        entry_price,
        credits_reward: credits_reward || 0,
        winners_count,
        prize_per_winner,
        status: 'open',
      });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('cagnotte_campaigns').update(req.body || {}).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabaseAdmin.from('cagnotte_campaigns').delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  return res.status(400).json({ error: `Ressource inconnue : ${resource}` });
});