import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../lib/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { sendBulkMail } from '../lib/mailer';

export default requireAuth(async (req, res, session) => {
  if (req.method === 'GET') {
    const { data: recipients } = await supabaseAdmin
      .from('profiles')
      .select('nom, email, secteur, ville, business')
      .not('email', 'is', null);

    const { data: campaigns } = await supabaseAdmin
      .from('mail_campaigns')
      .select('*')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false })
      .limit(50);

    return res.status(200).json({ recipients: recipients || [], campaigns: campaigns || [] });
  }

  if (req.method === 'POST') {
    const { subject, body, recipients, method } = req.body || {};

    if (!subject || !body || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Sujet, message et au moins un destinataire sont requis.' });
    }
    if (method !== 'manuel' && method !== 'automatique') {
      return res.status(400).json({ error: 'Méthode invalide.' });
    }

    if (method === 'automatique') {
      try {
        await sendBulkMail(subject, String(body).replace(/\n/g, '<br>'), recipients);
      } catch (err: any) {
        return res.status(500).json({ error: err.message || "Erreur lors de l'envoi automatique." });
      }
    }

    await supabaseAdmin.from('mail_campaigns').insert({
      user_id: session.userId,
      subject,
      body,
      recipients_count: recipients.length,
      method,
    });

    return res.status(200).json({ ok: true, method });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
});
