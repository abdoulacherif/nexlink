import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { requireAuth } from '../lib/auth';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action as string;

  // ============================================================
  // ACTION : PUBLIC (Consultation d'une fiche publique par slug ou id)
  // ============================================================
  if (action === 'public') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

    const { slug, id } = req.query;
    if (!slug && !id) return res.status(400).json({ error: 'Paramètre slug ou id requis.' });

    const publicFields = 'nom, business, ville, pays, secteur, whatsapp, description, avatar_url, slug, created_at';
    let query = supabaseAdmin.from('profiles').select(publicFields);

    if (slug) {
      query = query.eq('slug', String(slug).toLowerCase());
    } else {
      query = query.eq('user_id', String(id));
    }

    const { data: profile, error } = await query.maybeSingle();

    if (error) {
      console.error('[profiles/public]', error.message);
      return res.status(400).json({ error: 'Erreur de lecture.' });
    }
    if (!profile) return res.status(404).json({ error: 'Fiche introuvable.' });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ profile });
  }

  // ============================================================
  // ACTION : UPLOAD-AVATAR (Upload de photo de profil)
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

  // Si aucune action n'est reconnue
  return res.status(400).json({ error: 'Action inconnue.' });
}
