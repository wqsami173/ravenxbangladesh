const { pool, hasDatabaseUrl } = require('./db');
const nodemailer = require('nodemailer');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'wqsami173@gmail.com';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
const GMAIL_USER = process.env.GMAIL_USER || 'ravenxbdofficial@gmail.com';
const GMAIL_APP_PASSWORD = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const resendConfigured = Boolean(process.env.RESEND_API_KEY && EMAIL_FROM);
const gmailConfigured = Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);
const configured = gmailConfigured || resendConfigured;
const RESEND_API = 'https://api.resend.com/emails';
const gmailTransporter = gmailConfigured
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })
  : null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function emailLayout(title, body) {
  const styledBody = body
    .replace(/<p>/g, '<p style="margin:0 0 16px;color:#37443b;font-size:15px;line-height:1.65">')
    .replace(/<dl>/g, '<dl style="margin:22px 0;padding:18px 20px;background:#f5f7f4;border:1px solid #e5e9e3;border-radius:12px">')
    .replace(/<dt>/g, '<dt style="margin-top:12px;color:#758078;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">')
    .replace(/<dd>/g, '<dd style="margin:4px 0 0;color:#18211c;font-size:14px;font-weight:600;line-height:1.5">')
    .replace(/<a href=/g, '<a style="color:#bd4f11;font-weight:700;text-decoration:none" href=');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
    + escapeHtml(title) + '</title><style>body{margin:0!important;padding:0!important;background:#f0f2ee}table{border-collapse:collapse}a{color:#bd4f11}</style></head>'
    + '<body style="margin:0;padding:0;background:#f0f2ee;font-family:Arial,Helvetica,sans-serif;color:#18211c">'
    + '<div style="display:none;max-height:0;overflow:hidden;opacity:0">RavenX update · ' + escapeHtml(title) + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2ee"><tr><td align="center" style="padding:28px 12px">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e5e9e3;border-radius:16px;overflow:hidden">'
    + '<tr><td style="height:6px;background:#f27324;font-size:0;line-height:0">&nbsp;</td></tr>'
    + '<tr><td style="padding:24px 30px;background:#111915"><table role="presentation" width="100%"><tr>'
    + '<td style="color:#f7f8f5;font-size:19px;font-weight:800;letter-spacing:.18em">RAVEN<span style="color:#f27324">X</span></td>'
    + '<td align="right" style="color:#aab5ab;font-size:10px;font-weight:700;letter-spacing:.12em">Fly Like Raven</td>'
    + '</tr></table></td></tr>'
    + '<tr><td style="padding:34px 30px 14px"><div style="margin-bottom:9px;color:#bd4f11;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">RavenX update</div>'
    + '<h1 style="margin:0;color:#172019;font-size:25px;line-height:1.25">' + escapeHtml(title) + '</h1></td></tr>'
    + '<tr><td style="padding:12px 30px 28px;color:#37443b;font-size:15px;line-height:1.65">' + styledBody + '</td></tr>'
    + '<tr><td style="padding:20px 30px;background:#f7f8f6;border-top:1px solid #e9ece7;color:#778078;font-size:12px;line-height:1.6">RavenX Bangladesh<br>Fly Like Raven</td></tr>'
    + '</table><div style="padding:14px 10px;color:#89918a;font-size:11px">This is an automated message from RavenX.</div></td></tr></table></body></html>';
}

function emailButton(url, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td bgcolor="#e9691c" style="border-radius:8px">'
    + '<a style="display:inline-block;padding:12px 18px;color:#fff;font-size:13px;font-weight:700;text-decoration:none" href="' + escapeHtml(url) + '">'
    + escapeHtml(label) + '</a></td></tr></table>';
}

function template(name, data = {}) {
  const v = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, escapeHtml(value)]));
  const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const adminUrl = base + '/#/admin/registrations';
  const adminSubmissionUrl = base + '/#/admin/submissions';
  const userUrl = base + '/#/dashboard';
  const templates = {
    registration_admin: {
      subject: 'New Registration Request – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>' + (data.status === 'PENDING_APPROVAL' ? 'A registration is waiting for administrator review.' : 'A new registration was automatically approved by its event workflow.') + '</p><dl>'
        + '<dt>Participant</dt><dd>' + v.name + '</dd><dt>Email</dt><dd>' + v.email + '</dd>'
        + '<dt>Phone</dt><dd>' + v.phone + '</dd><dt>Registration ID</dt><dd>' + v.registrationId + '</dd>'
        + '<dt>Distance</dt><dd>' + v.distance + '</dd><dt>Payment method</dt><dd>' + v.paymentMethod + '</dd>'
        + '<dt>Transaction ID</dt><dd>' + (v.transactionId || 'Not provided') + '</dd>'
        + '<dt>Submitted</dt><dd>' + v.submittedAt + '</dd>'
        + (data.status === 'APPROVED' ? '<dt>BIB</dt><dd>' + (v.bib || 'Pending assignment') + '</dd>' : '')
        + '</dl>' + emailButton(adminUrl, 'Review registration')
    },
    submission_admin: {
      subject: 'New Run Submission – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>A running activity is waiting for administrator review.</p><dl>'
        + '<dt>Participant</dt><dd>' + v.name + '</dd><dt>Email</dt><dd>' + v.email + '</dd>'
        + '<dt>Phone</dt><dd>' + (v.phone || 'Not provided') + '</dd>'
        + '<dt>BIB</dt><dd>' + v.bib + '</dd><dt>Registration ID</dt><dd>' + v.registrationId + '</dd>'
        + '<dt>Distance</dt><dd>' + (v.distance || 'Not provided') + '</dd>'
        + '<dt>Activity link</dt><dd><a href="' + v.activityUrl + '">Open running activity</a></dd>'
        + (v.stravaProfileUrl ? '<dt>Running app profile</dt><dd><a href="' + v.stravaProfileUrl + '">Open profile</a></dd>' : '')
        + '<dt>Submitted</dt><dd>' + v.submittedAt + '</dd></dl>' + emailButton(adminSubmissionUrl, 'Review run submission')
    },
    welcome: {
      subject: 'Welcome to RavenX',
      html: '<p>Hi ' + v.name + ', your RavenX account is ready.</p>' + emailButton(userUrl, 'Open your dashboard')
    },
    registration_approved: {
      subject: 'Registration approved – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + v.name + ', your registration is approved.</p><p>Your BIB is <strong>' + v.bib + '</strong>.</p>' + emailButton(userUrl, 'Open My Events')
    },
    registration_rejected: {
      subject: 'Registration update – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + v.name + ', your registration was not approved.</p><p>Reason: ' + v.reason + '</p>' + emailButton(userUrl, 'Review your registration')
    },
    submission_received: {
      subject: 'Run submission received – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + v.name + ', your run submission for BIB ' + v.bib + ' is waiting for review.</p>' + emailButton(userUrl, 'Check submission status')
    },
    run_approved: {
      subject: 'Run approved – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + v.name + ', your run for BIB ' + v.bib + ' was approved.</p><p>Your certificate is available in your dashboard.</p>' + emailButton(userUrl, 'View your certificate')
    },
    run_rejected: {
      subject: 'Run submission update – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + v.name + ', your run for BIB ' + v.bib + ' needs an update.</p><p>Feedback: ' + v.feedback + '</p><p>You may submit an updated activity from your event dashboard.</p>' + emailButton(userUrl, 'Open My Events')
    },
    certificate_available: {
      subject: 'Certificate available – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + v.name + ', your verified finisher certificate is ready.</p>' + emailButton(userUrl, 'Preview or download certificate')
    },
    password_reset: {
      subject: 'Set or reset your RavenX password',
      html: '<p>Use this one-time link to set your password. The link expires in 30 minutes.</p>' + emailButton(data.resetUrl, 'Set password')
    },
    shop_order_admin: {
      subject: 'New RavenX shop order – ' + v.orderCode,
      html: '<p>A new jersey order is waiting for delivery processing.</p><dl>'
        + '<dt>Order</dt><dd>' + v.orderCode + '</dd><dt>Product</dt><dd>' + v.productName + '</dd>'
        + '<dt>Size / quantity</dt><dd>' + v.size + ' / ' + v.quantity + '</dd><dt>Total</dt><dd>৳' + v.total + '</dd>'
        + '<dt>Customer</dt><dd>' + v.name + '</dd><dt>Phone</dt><dd>' + v.phone + '</dd>'
        + '<dt>Email</dt><dd>' + v.email + '</dd><dt>District</dt><dd>' + v.district + '</dd>'
        + '<dt>Address</dt><dd>' + v.address + '</dd></dl>' + emailButton(base + '/#/admin/shop-orders', 'Review delivery order')
    },
    shop_order_received: {
      subject: 'RavenX received your jersey order – ' + v.orderCode,
      html: '<p>Hi ' + v.name + ', we received your Shadow Sprint jersey order.</p><dl>'
        + '<dt>Order</dt><dd>' + v.orderCode + '</dd><dt>Size / quantity</dt><dd>' + v.size + ' / ' + v.quantity + '</dd>'
        + '<dt>Total</dt><dd>৳' + v.total + '</dd></dl><p>RavenX will contact you to confirm delivery and payment arrangements.</p>'
    }
  };
  const selected = templates[name];
  if (!selected) throw new Error('Unknown email template: ' + name);
  return { subject: selected.subject, html: emailLayout(selected.subject, selected.html) };
}

async function enqueueEmail(client, recipient, templateName, data) {
  if (!recipient) return null;
  const result = await client.query(
    'INSERT INTO email_outbox (recipient, template_name, payload) VALUES ($1, $2, $3::jsonb) RETURNING id',
    [recipient, templateName, JSON.stringify(data || {})]
  );
  return result.rows[0].id;
}

async function sendOne(email) {
  const content = template(email.template_name, email.payload);
  if (gmailConfigured) {
    await gmailTransporter.sendMail({
      from: EMAIL_FROM || 'RavenX <' + GMAIL_USER + '>',
      to: email.recipient,
      subject: content.subject,
      html: content.html
    });
    return;
  }
  if (!resendConfigured) throw new Error('No email sender is configured.');
  const response = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json',
      'Idempotency-Key': email.id
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [email.recipient],
      subject: content.subject,
      html: content.html
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Resend returned HTTP ' + response.status + ': ' + (body.message || 'delivery failed'));
}

async function processOutbox() {
  if (!configured || !hasDatabaseUrl || !pool) return;
  const client = await pool.connect();
  let rows;
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'SELECT id, recipient, template_name, payload, attempts ' +
      'FROM email_outbox WHERE attempts < 12 AND (' +
      '(status = $1 AND next_attempt_at <= NOW()) OR ' +
      "(status = $2 AND locked_at < NOW() - INTERVAL '5 minutes')) " +
      'ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10',
      ['PENDING', 'SENDING']
    );
    rows = claimed.rows;
    if (rows.length) {
      await client.query(
        'UPDATE email_outbox SET status=$1, attempts=attempts+1, locked_at=NOW() WHERE id=ANY($2::uuid[])',
        ['SENDING', rows.map((row) => row.id)]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  for (const email of rows || []) {
    try {
      await sendOne(email);
      await pool.query(
        'UPDATE email_outbox SET status=$2, sent_at=NOW(), locked_at=NULL, last_error=NULL WHERE id=$1',
        [email.id, 'SENT']
      );
    } catch (error) {
      const attempts = Number(email.attempts || 0) + 1;
      const status = attempts >= 12 ? 'FAILED' : 'PENDING';
      const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
      await pool.query(
        'UPDATE email_outbox SET status=$2, locked_at=NULL, last_error=$3, ' +
        "next_attempt_at=NOW() + ($4::text || ' minutes')::interval WHERE id=$1",
        [email.id, status, String(error.message).slice(0, 500), delayMinutes]
      );
      console.error('Email delivery failed; queued for retry', { id: email.id, attempts, status });
    }
  }
}

module.exports = { ADMIN_EMAIL, emailConfigured: configured, enqueueEmail, processOutbox, template };

