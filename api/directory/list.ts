import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { getSession } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const { type } = req.query;

    // ---- Groupes WhatsApp (page business.html) ----
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

    // ---- Annuaire des profils (page annuaire.html) ----
    const { city, sector, q, offset, limit } = req.query;
    const from = parseInt((offset as string) || '0', 10) || 0;
    const size = Math.min(parseInt((limit as string) || '30', 10) || 30, 60);

    // Champs volontairement limités : jamais d'email, de credits, de solde ou
    // d'user_id exposés côté public via cette route.
    let query = supabaseAdmin
      .from('profiles')
      .select('nom, ville, pays, business, secteur, whatsapp, created_at', { count: 'exact' });

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
    return res.status(200).json({ profiles: data, total: count ?? 0 });
  }

  if (req.method === 'POST') {
    // Dépense de crédits (contact WhatsApp, téléchargement de fiche) — fait
    // ici côté serveur pour ne jamais laisser le client décider seul de son solde.
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Non authentifié' });

    const cost = parseInt(req.body?.amount, 10);
    if (!cost || cost <= 0) return res.status(400).json({ error: 'Montant invalide.' });

    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('credits')
      .eq('user_id', session.userId)
      .maybeSingle();

    if (profErr || !profile) return res.status(400).json({ error: 'Profil introuvable.' });

    const credits = profile.credits || 0;
    if (credits < cost) {
      return res.status(402).json({ error: 'Crédits insuffisants.', credits, needed: cost });
    }

    const { error: updErr } = await supabaseAdmin
      .from('profiles')
      .update({ credits: credits - cost })
      .eq('user_id', session.userId);

    if (updErr) return res.status(400).json({ error: updErr.message });
    return res.status(200).json({ ok: true, credits: credits - cost });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
}
