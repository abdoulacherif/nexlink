import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

const COMMISSION_CAP_PER_FILLEUL = 5000;

export default requireAdmin(async (req, res) => {
  const resource = (req.query.resource as string) || 'profiles';

  // --- FICHES (profiles) ---
  if (resource === 'profiles') {
    if (req.method === 'GET') {
      const q = (req.query.q as string) || '';
      const offset = parseInt((req.query.offset as string) || '0', 10) || 0;
      const limit = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 100);

      let query = supabaseAdmin.from('profiles').select('*', { count: 'exact' });
      if (q) {
        const safe = q.replace(/[%,]/g, '');
        query = query.or(`nom.ilike.%${safe}%,business.ilike.%${safe}%,whatsapp.ilike.%${safe}%,email.ilike.%${safe}%,ville.ilike.%${safe}%`);
      }
      query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ profiles: data, total: count ?? 0 });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      if (action === 'grant-commission') {
        const { referredBy, sourceName, sourceUserId, sourceEmail, sourceWhatsapp, amount } = req.body || {};
        const purchase = parseFloat(amount);
        if (!purchase || purchase <= 0) return res.status(400).json({ error: 'Montant invalide.' });

        const { data: referrer } = await supabaseAdmin
          .from('profiles').select('user_id, solde, email, whatsapp').eq('referral_code', referredBy).maybeSingle();
        if (!referrer) return res.status(404).json({ error: 'Parrain introuvable pour ce code.' });

        const referrerEmail = (referrer.email || '').toLowerCase();
        const srcEmail = (sourceEmail || '').toLowerCase();
        if ((srcEmail && srcEmail === referrerEmail) || (sourceWhatsapp && sourceWhatsapp === referrer.whatsapp)) {
          return res.status(400).json({ error: 'Auto-parrainage détecté.' });
        }

        const commission = Math.round(purchase * 0.1);

        if (sourceUserId) {
          const { data: earnings } = await supabaseAdmin
            .from('referral_earnings').select('amount').eq('referrer_id', referrer.user_id).eq('source_user_id', sourceUserId);
          const already = (earnings || []).reduce((s: number, e: any) => s + (e.amount || 0), 0);
          if (already + commission > COMMISSION_CAP_PER_FILLEUL) {
            const remaining = Math.max(0, COMMISSION_CAP_PER_FILLEUL - already);
            return res.status(400).json({ error: `Plafond atteint. Reste : ${remaining} FCFA.` });
          }
        }

        const { data, error } = await supabaseAdmin.rpc('grant_commission', {
          p_referrer_user_id: referrer.user_id,
          p_source_name: sourceName || null,
          p_source_user_id: sourceUserId || null,
          p_amount: commission,
        });
        if (error) return res.status(400).json({ error: error.message });
        const result = data as { ok: boolean; solde?: number; error?: string };
        if (!result.ok) return res.status(400).json({ error: result.error });

        return res.status(200).json({ ok: true, commission, solde: result.solde });
      }

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

  // --- BARRE DE NAVIGATION ---
  if (resource === 'nav-items') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('nav_items').select('*').order('position', { ascending: true });
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

  // --- RETRAITS ---
  if (resource === 'withdrawals') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('withdrawal_requests').select('*').order('created_at', { ascending: false });
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

  // --- ABONNEMENTS ---
  if (resource === 'subscriptions') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('subscription_requests').select('*').order('created_at', { ascending: false });
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

  // --- FORFAITS ---
  if (resource === 'plans') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('subscription_plans').select('*').order('position', { ascending: true });
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

  // --- OFFRES SERVEUR ---
  if (resource === 'server-offers') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('server_offers').select('*').order('position', { ascending: true });
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

  // --- COMMANDES SERVEUR ---
  if (resource === 'server-orders') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('server_orders').select('*').order('created_at', { ascending: false });
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

  // --- SERVICES BUSINESS ---
  if (resource === 'biz-services') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('business_services').select('*').order('position', { ascending: true });
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

  // --- COMMANDES BUSINESS ---
  if (resource === 'biz-orders') {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('business_orders').select('*').order('created_at', { ascending: false });
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

  // --- CAGNOTTES ---
  if (resource === 'cagnottes') {
    if (req.method === 'GET') {
      const campaignId = req.query.campaignId as string | undefined;
      if (campaignId) {
        const { data: entries, error } = await supabaseAdmin.from('cagnotte_entries').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: false });
        if (error) return res.status(400).json({ error: error.message });
        const userIds = [...new Set((entries || []).map((e: any) => e.user_id))];
        const { data: profiles } = await supabaseAdmin.from('profiles').select('user_id, nom, business, whatsapp').in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);
        const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.user_id, p]));
        const merged = (entries || []).map((e: any) => ({ ...e, profile: profileMap[e.user_id] || null }));
        return res.status(200).json({ entries: merged });
      }

      const { data: campaigns, error } = await supabaseAdmin.from('cagnotte_campaigns').select('*').order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      const withCounts = await Promise.all(
        (campaigns || []).map(async (c: any) => {
          const { count: total } = await supabaseAdmin.from('cagnotte_entries').select('*', { count: 'exact', head: true }).eq('campaign_id', c.id);
          const { count: verified } = await supabaseAdmin.from('cagnotte_entries').select('*', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('verified', true);
          return { ...c, entries_count: total ?? 0, verified_count: verified ?? 0 };
        })
      );
      return res.status(200).json({ items: withCounts });
    }

    if (req.method === 'POST') {
      const { action } = req.body || {};

      if (action === 'verify-entry') {
        const { entryId, verified } = req.body || {};
        if (!entryId) return res.status(400).json({ error: 'entryId requis' });
        const { error } = await supabaseAdmin.from('cagnotte_entries').update({ verified: !!verified }).eq('id', entryId);
        if (error) return res.status(400).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      if (action === 'draw') {
        const { campaignId } = req.body || {};
        if (!campaignId) return res.status(400).json({ error: 'campaignId requis' });
        const { data: campaign } = await supabaseAdmin.from('cagnotte_campaigns').select('*').eq('id', campaignId).maybeSingle();
        if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });
        if (campaign.status === 'drawn') return res.status(400).json({ error: 'Le tirage a déjà eu lieu.' });

        const prizeTiers: number[] = Array.isArray(campaign.prize_tiers) ? campaign.prize_tiers : [];
        if (prizeTiers.length === 0) return res.status(400).json({ error: "Pas de paliers de gains définis." });

        const { data: entries, error: entErr } = await supabaseAdmin.from('cagnotte_entries').select('*').eq('campaign_id', campaignId).eq('verified', true);
        if (entErr) return res.status(400).json({ error: entErr.message });
        if (!entries || entries.length === 0) return res.status(400).json({ error: 'Aucun participant vérifié.' });

        const shuffled = [...entries].sort(() => Math.random() - 0.5);
        const winners = shuffled.slice(0, prizeTiers.length);
        for (let i = 0; i < winners.length; i++) {
          const w = winners[i];
          const prize = prizeTiers[i];
          const { data: profile } = await supabaseAdmin.from('profiles').select('solde').eq('user_id', w.user_id).maybeSingle();
          const solde = profile?.solde || 0;
          await supabaseAdmin.from('profiles').update({ solde: solde + prize }).eq('user_id', w.user_id);
          await supabaseAdmin.from('cagnotte_entries').update({ is_winner: true, amount_won: prize, rank: i + 1 }).eq('id', w.id);
        }
        await supabaseAdmin.from('cagnotte_campaigns').update({ status: 'drawn', drawn_at: new Date().toISOString() }).eq('id', campaignId);
        return res.status(200).json({ ok: true, winnersCount: winners.length, eligibleCount: entries.length, winners: winners.map((w: any) => w.user_id) });
      }

      const { name, entry_price, credits_reward, prize_tiers, promo_instructions } = req.body || {};
      if (!name || !entry_price || !Array.isArray(prize_tiers) || prize_tiers.length === 0) return res.status(400).json({ error: 'Champs manquants.' });
      const { error } = await supabaseAdmin.from('cagnotte_campaigns').insert({ name, entry_price, credits_reward: credits_reward || 0, prize_tiers, promo_instructions: promo_instructions || null, status: 'open' });
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

  // ---------------------------------------------------------------
  // GÉNÉRATION DE SLUGS (par paquets, pour ne pas bloquer la base)
  // ---------------------------------------------------------------
  if (resource === 'generate-slugs') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

    const count = Math.min(parseInt(req.body?.count, 10) || 100, 5000);

    const { data: profiles, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('id, business, user_id')
      .or('slug.is.null,slug.eq.')
      .limit(count);

    if (fetchError) return res.status(400).json({ error: fetchError.message });
    if (!profiles || profiles.length === 0) {
      return res.status(200).json({ ok: true, updated: 0, remaining: 0 });
    }

    let updated = 0;
    for (const p of profiles) {
      let base = (p.business || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!base) base = 'membre';
      const slug = `${base}-${p.user_id.slice(0, 4)}`;

      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ slug })
        .eq('id', p.id);

      if (!updateError) updated++;
    }

    const { count: remaining } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .or('slug.is.null,slug.eq.');

    return res.status(200).json({ ok: true, updated, remaining: remaining ?? 0 });
  }

  return res.status(400).json({ error: `Ressource inconnue : ${resource}` });
});
