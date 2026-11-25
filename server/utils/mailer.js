// Outgoing mail for the self-hosted edition. Same SMTP_* variables as the cloud
// edition, so one deployment config serves both. Without SMTP_HOST nothing is
// sent and callers fall back to what the instance can do by hand (an admin
// resetting a password from Admin › Users).

const nodemailer = require('nodemailer');

let transport = null;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

function getTransport() {
  if (transport) return transport;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 587 upgrades with STARTTLS
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) return false;
  await getTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject, text, html,
  });
  return true;
}

// Links in mails must point at the address users open the app at, never at
// whatever Host header the request carried (a forged Host would mail out a
// link to the attacker's server holding a valid reset token).
function publicUrl() {
  const url = process.env.PUBLIC_URL || process.env.APP_URL || '';
  return url.replace(/\/+$/, '');
}

module.exports = { isConfigured, sendMail, publicUrl };
