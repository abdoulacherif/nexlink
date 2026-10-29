import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { requireAuth } from '../lib/auth';

export const config = {
  api: {
    bodyParser: { sizeLimit: '5mb' },
  },
};

function genReferralCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makeSlug(text: string, userId: string): string {
  let base = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!base) base = 'membre';
  return `${base}-${userId.slice(0, 4)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action as string;

  // ============================================================
  // ROUTE PUBLIQUE (accessible à tous)
  // ============================================================
  if (action === 'public') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

    const { slug, id } = req.query;
    if (!slug && !id) return res.status(400).json({ error: 'Paramètre slug ou id requis.' });

    const publicFields = 'nom, business, ville, pays, secteur, whatsapp, description, avatar_url, slug, created_at, user_id';
    
    // 1. On cherche par slug ou par ID
    let query = supabaseAdmin.from('profiles').select(publicFields);
    if (slug) query = query.eq('slug', String(slug).toLowerCase());
    else query = query.eq('user_id', String(id));

    let { data: profile, error } = await query.maybeSingle();

    if (error) {
      console.error('[profiles/public]', error.message);
      return res.status(400).json({ error: 'Erreur de lecture.' });
    }
    if (!profile) return res.status(404).json({ error: 'Fiche introuvable.' });

    // 2. ASTUCE DEV SENIOR : Si le profil existe mais n'a pas de slug, on le génère et on le sauvegarde
    if (!profile.slug && profile.business) {
      const newSlug = makeSlug(profile.business, profile.user_id);
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ slug: newSlug })
        .eq('user_id', profile.user_id);

      if (!updateError) {
        profile.slug = newSlug; // On met à jour l'objet renvoyé
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ profile });
  }

  // ============================================================
  // UPLOAD AVATAR (connecté requis)
  // ============================================================
  if (action === 'upload-avatar') {
    return requireAuth(async (req, res, session) => {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

      const { base64Image, mimeType } = req.body || {};
      if (!base64Image || !mimeType) return res.status(400).json({ error: 'Image manquante.' });

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        return res.status(400).json({ error: "Format d'image non supporté." });
      }

      const buffer = Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const fileName = `${session.userId}-${Date.now()}.${mimeType.split('/')[1]}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('avatars')
        .upload(fileName, buffer, { contentType: mimeType, upsert: true });

      if (uploadError) {
        console.error('[upload-avatar]', uploadError.message);
        return res.status(400).json({ error: "Erreur lors de l'upload." });
      }

      const { data: urlData } = supabaseAdmin.storage.from('avatars').getPublicUrl(fileName);
      const avatarUrl = urlData.publicUrl;

      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('user_id', session.userId);

      if (updateError) return res.status(400).json({ error: updateError.message });

      return res.status(200).json({ ok: true, avatar_url: avatarUrl });
    })(req, res);
  }

  // ============================================================
  // ROUTES CLASSIQUES DU PROFIL (connecté requis)
  // ============================================================
  return requireAuth(async (req, res, session) => {
    if (req.method === 'GET') {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('user_id', session.userId)
        .maybeSingle();

      const results = await Promise.allSettled([
        supabaseAdmin.from('referral_earnings').select('*').eq('referrer_id', session.userId).order('created_at', { ascending: false }),
        supabaseAdmin.from('payments').select('*').eq('user_id', session.userId).order('created_at', { ascending: false }),
        supabaseAdmin.from('withdrawal_requests').select('*').eq('user_id', session.userId).order('created_at', { ascending: false }),
        supabaseAdmin.from('subscription_requests').select('*').eq('user_id', session.userId).order('created_at', { ascending: false }),
        supabaseAdmin.from('server_orders').select('*').eq('user_id', session.userId).order('created_at', { ascending: false }),
        supabaseAdmin.from('business_orders').select('*').eq('user_id', session.userId).order('created_at', { ascending: false }),
        supabaseAdmin.from('cagnotte_entries').select('*, cagnotte_campaigns(name, status)').eq('user_id', session.userId).order('created_at', { ascending: false }),
        profile?.referral_code
          ? supabaseAdmin.from('profiles').select('nom, business, ville, created_at', { count: 'exact' }).eq('referred_by', profile.referral_code).order('created_at', { ascending: false })
          : Promise.resolve({ data: [], count: 0 }),
      ]);

      const pick = (r: PromiseSettledResult<any>) => (r.status === 'fulfilled' ? r.value.data || [] : []);
      const referralsResult = results[7];
      const referrals = referralsResult.status === 'fulfilled' ? referralsResult.value.data || [] : [];
      const referralsCount = referralsResult.status === 'fulfilled' ? referralsResult.value.count ?? referrals.length : 0;

      return res.status(200).json({
        profile,
        earnings: pick(results[0]),
        payments: pick(results[1]),
        withdrawals: pick(results[2]),
        subscriptions: pick(results[3]),
        serverOrders: pick(results[4]),
        bizOrders: pick(results[5]),
        cagnotteEntries: pick(results[6]),
        referrals,
        referralsCount,
      });
    }

    if (req.method === 'POST') {
      const { nom, whatsapp, pays, ville, business, secteur } = req.body || {};
      if (!nom || !whatsapp || !pays || !ville || !business || !secteur) {
        return res.status(400).json({ error: 'Merci de remplir tous les champs.' });
      }

      let slug = makeSlug(business, session.userId);
      let counter = 0;
      while (true) {
        const { data: existing } = await supabaseAdmin.from('profiles').select('user_id').eq('slug', slug).maybeSingle();
        if (!existing || existing.user_id === session.userId) break;
        counter++;
        slug = `${makeSlug(business, session.userId)}-${counter}`;
      }

      const { data, error } = await supabaseAdmin
        .from('profiles')
        .insert({
          user_id: session.userId,
          email: session.email,
          nom, whatsapp, pays, ville, business, secteur,
          referral_code: genReferralCode(),
          slug,
        })
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ profile: data });
    }

    if (req.method === 'PATCH') {
      const { action: patchAction, entryId, proofUrl } = req.body || {};

      if (patchAction === 'submit-cagnotte-proof') {
        if (!entryId || !proofUrl) return res.status(400).json({ error: 'Champs manquants.' });
        const { data: entry } = await supabaseAdmin.from('cagnotte_entries').select('user_id').eq('id', entryId).maybeSingle();
        if (!entry || entry.user_id !== session.userId) return res.status(403).json({ error: 'Non autorisé.' });

        const { error } = await supabaseAdmin.from('cagnotte_entries').update({ proof_url: proofUrl, verified: false }).eq('id', entryId);
        if (error) return res.status(400).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      const { nom, whatsapp, ville, pays, business, secteur, description } = req.body || {};
      
      const { data: currentProfile } = await supabaseAdmin.from('profiles').select('slug').eq('user_id', session.userId).maybeSingle();

      let updates: any = { nom, whatsapp, ville, pays, business, secteur };
      if (description !== undefined) updates.description = description;

      if (!currentProfile?.slug && business) {
        updates.slug = makeSlug(business, session.userId);
      }

      const { error } = await supabaseAdmin.from('profiles').update(updates).eq('user_id', session.userId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PUT') {
      const { password } = req.body || {};
      if (!password || password.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
      }
      const { error } = await supabaseAdmin.auth.admin.updateUserById(session.userId, { password });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { error } = await supabaseAdmin.from('profiles').delete().eq('user_id', session.userId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });
  })(req, res);
}
