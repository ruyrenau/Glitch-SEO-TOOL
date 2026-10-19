import nodemailer from 'nodemailer';

/**
 * Outgoing email (invitations, password resets). Configure SMTP_URL (smtp[s]://user:pass@host:port) and
 * MAIL_FROM. Without SMTP nothing is sent: invitations show a link to copy and share by hand, and password
 * resets are not offered.
 */

export const mailConfigured = () => !!process.env.SMTP_URL;
export const webOrigin = () => (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim().replace(/\/$/, '');

/** Messages sent in tests (SMTP_URL=test://). */
export const sentMail: Array<{ to: string; subject: string; text: string }> = [];

let transport: nodemailer.Transporter | null = null;

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  const url = process.env.SMTP_URL;
  if (!url) return { sent: false };
  if (url.startsWith('test://')) {
    sentMail.push({ to, subject, text });
    return { sent: true };
  }
  transport ??= nodemailer.createTransport(url);
  await transport.sendMail({ from: process.env.MAIL_FROM ?? 'G.SEO <no-reply@localhost>', to, subject, text, html });
  return { sent: true };
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/** A plain, readable email with one button. */
export function simpleHtml(title: string, lines: string[], button: { label: string; url: string }) {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1e293b;max-width:520px;margin:auto;padding:24px">
<h2 style="margin:0 0 12px">${escape(title)}</h2>${lines.map(l => `<p style="margin:0 0 10px;line-height:1.5">${escape(l)}</p>`).join('')}
<p style="margin:20px 0"><a href="${escape(button.url)}" style="background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${escape(button.label)}</a></p>
<p style="font-size:12px;color:#64748b">Si el botón no funciona, copia este enlace: ${escape(button.url)}</p></body></html>`;
}
