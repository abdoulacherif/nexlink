import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export async function sendWelcomeEmail(name: string, email: string) {
  await transporter.sendMail({
    from: `Kontak <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Bienvenue sur Kontak !',
    html: `<p>Bonjour ${name},</p><p>Ton compte Kontak a bien été créé. Bienvenue dans le réseau !</p>`,
  });
}

export async function sendAdminNotifEmail(name: string, email: string, phone: string) {
  await transporter.sendMail({
    from: `Kontak <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: 'Nouveau membre inscrit',
    html: `<p>Nom: ${name}</p><p>Email: ${email}</p><p>WhatsApp: ${phone}</p>`,
  });
}

// Envoi groupé (mode "automatique" de mail.html) — Gmail limite les volumes
// (quotas quotidiens et par lot), donc on envoie par petits paquets en BCC.
export async function sendBulkMail(subject: string, htmlBody: string, recipients: string[]) {
  const chunkSize = 40;
  for (let i = 0; i < recipients.length; i += chunkSize) {
    const chunk = recipients.slice(i, i + chunkSize);
    await transporter.sendMail({
      from: `Kontak <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      bcc: chunk,
      subject,
      html: htmlBody,
    });
  }
}