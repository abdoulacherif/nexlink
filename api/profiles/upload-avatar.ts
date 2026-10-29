import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../../lib/auth';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};

export default requireAuth(async (req, res, session) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { base64Image, mimeType } = req.body || {};
  if (!base64Image || !mimeType) {
    return res.status(400).json({ error: 'Image manquante.' });
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    return res.status(400).json({ error: "Format d'image non supporté (JPEG, PNG, WEBP uniquement)." });
  }

  const buffer = Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  const fileName = `${session.userId}-${Date.now()}.${mimeType.split('/')[1]}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('avatars')
    .upload(fileName, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) {
    console.error('[upload-avatar]', uploadError.message);
    return res.status(400).json({ error: "Erreur lors de l'upload." });
  }

  const { data: urlData } = supabaseAdmin.storage
    .from('avatars')
    .getPublicUrl(fileName);

  const avatarUrl = urlData.publicUrl;

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('user_id', session.userId);

  if (updateError) {
    return res.status(400).json({ error: updateError.message });
  }

  return res.status(200).json({ ok: true, avatar_url: avatarUrl });
});
