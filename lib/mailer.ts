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