import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { getSession } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const { type } = req.query;

    // ---- Groupes WhatsApp ----
    if (type === 'groups') {
      const { theme, q, offset, limit } = req.query;
      const from = parseInt((offset as string) || '0', 10) || 0;
      const size = Math.min(parseInt((limit as string) || '40', 10) || 40, 60);

      let query = supabaseAdmin
        .from('whatsapp_groups')
        .select('name, theme, invite_link', { count: 'exact' })
        .eq('active', true);

      if (theme) query = query.eq('theme', theme as string);
      if (q) {
        const safe = String(q).replace(/[%,]/g, '');
        query = query.or(`name.ilike.%${safe}%,theme.ilike.%${safe}%`);
      }
      query = query.order('position', { ascending: true }).range(from, from + size - 1);

      const { data, error, count } = await query;
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ groups: data, total: count ?? 0 });
    }

    if (type === 'group-themes') {
      const { data, error } = await supabaseAdmin
        .from('whatsapp_groups')
        .select('theme')
        .eq('active', true);
      if (error) return res.status(400).json({ error: error.message });
      const themes = Array.from(new Set((data || []).map((g: any) => g.theme).filter(Boolean))).sort();
      return res.status(200).json({ themes });
    }

    // ---- Cagnottes ----
    if (type === 'cagnottes') {
      const { data, error } = await supabaseAdmin
        .from('cagnotte_campaigns')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ campaigns: data });
    }

    // ---- Annuaire public ----
    const { city, sector, q, offset, limit } = req.query;
    const from = parseInt((offset as string) || '0', 10) || 0;
    const size = Math.min(parseInt((limit as string) || '30', 10) || 30, 60);

    // On ajoute "user_id" et "slug" pour le lien vers la fiche
    let query = supabaseAdmin
      .from('profiles')
      .select('nom, ville, pays, business, secteur, whatsapp, slug, avatar_url, user_id, created_at', { count: 'exact' });

    if (city) query = query.ilike('ville', `%${city}%`);
    if (sector) query = query.eq('secteur', sector as string);
    if (q) {
      const safe = String(q).replace(/[%,]/g, '');
      query = query.or(
        `nom.ilike.%${safe}%,ville.ilike.%${safe}%,pays.ilike.%${safe}%,business.ilike.%${safe}%,secteur.ilike.%${safe}%`
      );
    }
    query = query.order('created_at', { ascending: false }).range(from, from + size - 1);

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ profiles: data, total: count ?? 0 });
  }

  // ---- POST : dépense de crédits ----
  if (req.method === 'POST') {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Non authentifié' });

    const cost = parseInt(req.body?.amount, 10);
    const targetUserId = req.body?.targetUserId as string | undefined;
    
    if (!cost || cost <= 0) return res.status(400).json({ error: 'Montant invalide.' });

    if (targetUserId) {
      const { data, error } = await supabaseAdmin.rpc('unlock_contact', {
        p_user_id: session.userId,
        p_target_user_id: targetUserId,
        p_cost: cost,
      });
      
      if (error) {
        console.error('[directory/list] unlock_contact:', error.message);
        return res.status(400).json({ error: error.message });
      }
      
      const result = data as { ok: boolean; credits?: number; already_unlocked?: boolean; error?: string };
      if (!result.ok) {
        return res.status(402).json({ error: result.error || 'Crédits insuffisants', credits: result.credits });
      }
      return res.status(200).json({ ok: true, credits: result.credits, already_unlocked: result.already_unlocked });
    }

    const { data, error } = await supabaseAdmin.rpc('spend_credits', {
      p_user_id: session.userId,
      p_amount: cost,
    });
    
    if (error) {
      console.error('[directory/list] spend_credits:', error.message);
      return res.status(400).json({ error: error.message });
    }
    
    const result = data as { ok: boolean; credits?: number; error?: string };
    if (!result.ok) return res.status(402).json({ error: result.error || 'Crédits insuffisants' });
    
    return res.status(200).json({ ok: true, credits: result.credits });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
}
