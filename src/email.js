const { pool, hasDatabaseUrl } = require('./db');
const nodemailer = require('nodemailer');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'wqsami173@gmail.com';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
const GMAIL_USER = process.env.GMAIL_USER || 'ravenxbdofficial@gmail.com';
const GMAIL_APP_PASSWORD = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const EMAIL_HERO_IMAGE_URL = process.env.EMAIL_HERO_IMAGE_URL || '';
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

function httpsImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? escapeHtml(url.href) : '';
  } catch {
    return '';
  }
}

function emailLayout(title, body, data = {}) {
  const styledBody = body
    .replace(/<p>/g, '<p style="margin:0 0 16px;color:#46392f;font-size:15px;line-height:1.7">')
    .replace(/<dl>/g, '<dl style="margin:22px 0;padding:18px 20px;background:#fffaf2;border:1px solid #eadbc8">')
    .replace(/<dt>/g, '<dt style="margin-top:12px;color:#97765d;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">')
    .replace(/<dd>/g, '<dd style="margin:4px 0 0;color:#241d19;font-size:14px;font-weight:600;line-height:1.5;word-break:break-word">')
    .replace(/<a href=/g, '<a style="color:#a7431d;font-weight:700;text-decoration:underline" href=');
  const heroImage = httpsImageUrl(data.eventBannerUrl || EMAIL_HERO_IMAGE_URL);
  const hero = heroImage
    ? '<tr><td style="padding:0;background:#211916"><img src="' + heroImage + '" width="600" alt="RavenX running event" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>'
    : '<tr><td style="padding:22px 30px;background:#e9dcc8"><div style="color:#8b3b1d;font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase">RavenX running events</div><div style="padding-top:7px;color:#211916;font-size:12px;letter-spacing:.12em">MOVE WITH PURPOSE&nbsp;&nbsp; • &nbsp;&nbsp;FLY LIKE RAVEN</div></td></tr>';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
    + escapeHtml(title) + '</title></head>'
    + '<body style="margin:0;padding:0;background:#eee8de;font-family:Arial,Helvetica,sans-serif;color:#241d19">'
    + '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">RavenX update · ' + escapeHtml(title) + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#eee8de"><tr><td align="center" style="padding:28px 12px">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#fffdf9;border:1px solid #e5d8c7">'
    + '<tr><td style="height:6px;background:#df5a25;font-size:0;line-height:0">&nbsp;</td></tr>'
    + '<tr><td style="padding:22px 30px;background:#182b29"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td style="color:#fffaf2;font-size:20px;font-weight:900;letter-spacing:.13em">RAVEN<span style="color:#f07a36">X</span></td>'
    + '<td align="right" style="color:#e9d8c4;font-size:11px;font-weight:700;letter-spacing:.1em">FLY LIKE RAVEN</td>'
    + '</tr></table></td></tr>' + hero
    + '<tr><td style="padding:30px 30px 10px"><div style="margin-bottom:9px;color:#bb4d22;font-size:10px;font-weight:800;letter-spacing:.17em;text-transform:uppercase">RavenX · Event update</div>'
    + '<h1 style="margin:0;color:#211916;font-size:27px;line-height:1.2;font-weight:900">' + escapeHtml(title) + '</h1></td></tr>'
    + '<tr><td style="padding:14px 30px 30px;color:#46392f;font-size:15px;line-height:1.7">' + styledBody + '</td></tr>'
    + '<tr><td style="padding:20px 30px;background:#f5efe6;border-top:1px solid #eadbc8;color:#776656;font-size:12px;line-height:1.7">RavenX Bangladesh<br><strong style="color:#8e401f;letter-spacing:.08em">FLY LIKE RAVEN</strong></td></tr>'
    + '</table><div style="padding:14px 10px;color:#897d70;font-size:11px">This is an automated message from RavenX.</div></td></tr></table></body></html>';
}

function emailButton(url, label) {
  if (!url) return '';
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px"><tr><td bgcolor="#d95724" style="background:#d95724">'
    + '<a style="display:inline-block;padding:14px 22px;color:#fffaf2;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:.04em" href="' + escapeHtml(url) + '">'
    + escapeHtml(label) + '</a></td></tr></table>';
}

function emailDetails(fields) {
  const rows = fields
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => '<tr><td style="padding:10px 12px;border-bottom:1px solid #eee2d4;color:#92785f;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">'
      + escapeHtml(label) + '</td><td align="right" style="padding:10px 12px;border-bottom:1px solid #eee2d4;color:#2b211b;font-size:12px;font-weight:700;line-height:1.5">'
      + escapeHtml(value) + '</td></tr>');
  return rows.length
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;background:#fffaf2;border:1px solid #eadbc8">' + rows.join('') + '</table>'
    : '';
}

function raceCard(data, showStatus = false) {
  const bib = data.bib && data.bib !== 'Pending assignment'
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0"><tr><td style="padding:18px 20px;background:#182b29;color:#fffaf2">'
      + '<div style="color:#efb27d;font-size:10px;font-weight:700;letter-spacing:.16em">YOUR RACE BIB</div><div style="padding-top:5px;font-size:34px;font-weight:900;letter-spacing:.08em">' + escapeHtml(data.bib) + '</div></td></tr></table>'
    : '';
  const details = emailDetails([
    ['Participant', data.name], ['Event', data.eventName], ['Event category', data.category || data.distance],
    ['Registration ID', data.registrationId], ['Event date', data.eventDate], ['Event time', data.eventTime],
    ['Venue', data.venue || data.location], ...(showStatus ? [['Registration status', data.status]] : [])
  ]);
  return bib + details;
}

function template(name, data = {}) {
  const v = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, escapeHtml(value)]));
  const text = (key, fallback = '') => v[key] || fallback;
  const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const adminUrl = base + '/#/admin/registrations';
  const adminSubmissionUrl = base + '/#/admin/submissions';
  const userUrl = base + '/#/dashboard';
  const templates = {
    registration_admin: {
      subject: 'New Registration Request – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>' + (data.status === 'PENDING_APPROVAL' ? 'A registration is waiting for your review.' : 'A registration was automatically approved by its event workflow.') + '</p>'
        + raceCard(data, true) + emailDetails([['Email', data.email], ['Phone', data.phone], ['Payment method', data.paymentMethod],
          ['Transaction ID', data.transactionId], ['Submitted', data.submittedAt], ...(data.status === 'APPROVED' && !data.bib ? [['BIB', 'Pending assignment']] : [])])
        + emailButton(adminUrl, 'Review registration')
    },
    submission_admin: {
      subject: 'New Run Submission – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>A running activity is waiting for administrator review.</p>' + raceCard(data)
        + emailDetails([['Email', data.email], ['Phone', data.phone], ['Submitted', data.submittedAt]])
        + (data.activityUrl ? '<p><a href="' + escapeHtml(data.activityUrl) + '">Open submitted activity</a></p>' : '')
        + (data.screenshotUrl ? '<p><a href="' + escapeHtml(data.screenshotUrl) + '">View running screenshot</a></p>' : '')
        + emailButton(adminSubmissionUrl, 'Review run submission')
    },
    welcome: {
      subject: 'Welcome to RavenX',
      html: '<p>Hi ' + text('name', 'runner') + ', welcome to the RavenX community. Your account is ready for the miles ahead.</p>'
        + '<p><strong>Fly Like Raven.</strong> Sign in any time to explore your registrations and event updates.</p>' + emailButton(userUrl, 'Open your dashboard')
    },
    registration_account_created: {
      subject: 'Your RavenX account and registration',
      html: '<p>Hi ' + text('name', 'runner') + ', your RavenX account and event registration are ready.</p>'
        + raceCard(data, true)
        + '<p>Sign in with the email address and password you chose during registration. For your security, RavenX never emails passwords.</p>'
        + emailButton(userUrl, 'Open My Events')
    },
    registration_received: {
      subject: 'Registration received – ' + (data.eventName || 'RavenX event'),
      html: '<p>Hi ' + text('name', 'runner') + ', your request to join ' + text('eventName', 'the RavenX event') + ' has reached us.</p>'
        + raceCard(data, true) + '<p>Your registration is <strong>pending administrator review</strong>. We’ll email you as soon as its status changes.</p>'
        + emailButton(userUrl, 'Open My Events')
    },
    chat_handoff_admin: {
      subject: 'RavenX chat request from ' + (data.name || 'a visitor'),
      html: '<p>' + text('name', 'A visitor') + ' requested a reply from the RavenX administrator.</p>'
        + emailDetails([['Contact email', data.email], ['Conversation', data.conversationId]])
        + (data.conversationId ? emailButton(base + '/#/admin/chats?id=' + encodeURIComponent(data.conversationId), 'Open chat inbox') : '')
    },
    chat_message_admin: {
      subject: 'New RavenX message from ' + (data.name || 'a visitor'),
      html: '<p>A visitor sent a message to RavenX support. Reply from the admin chat inbox.</p>'
        + emailDetails([['Name', data.name], ['Email', data.email]])
        + '<div style="padding:16px 18px;background:#f5efe6;border-left:3px solid #d95724;color:#46392f;white-space:pre-wrap">' + text('message') + '</div>'
        + (data.conversationId ? emailButton(base + '/#/admin/chats?id=' + encodeURIComponent(data.conversationId), 'Open and reply') : '')
    },
    chat_admin_reply: {
      subject: 'A new reply from RavenX',
      html: '<p>Hi ' + text('name', 'there') + ', a RavenX administrator replied to your message.</p>'
        + '<div style="margin:18px 0;padding:16px 18px;border-left:3px solid #d95724;background:#f7f0e7;color:#46392f;white-space:pre-wrap">' + text('message') + '</div>'
        + '<p>Open RavenX on the same browser you used for your chat to continue the conversation.</p>'
        + emailButton(base + '/#/', 'Open RavenX')
    },
    registration_approved: {
      subject: 'Registration approved – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + text('name', 'runner') + ', your registration is approved. Your place in the event is confirmed.</p>'
        + raceCard(data) + emailButton(userUrl, 'Open My Events')
    },
    registration_rejected: {
      subject: 'Registration update – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + text('name', 'runner') + ', we’re sorry, but this registration was not approved.</p>'
        + emailDetails([['Event', data.eventName], ['Reason', data.reason]]) + emailButton(userUrl, 'Review your registration')
    },
    submission_received: {
      subject: 'Run submission received – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + text('name', 'runner') + ', we received your run submission. It is now waiting for review.</p>'
        + raceCard(data) + emailButton(userUrl, 'Check submission status')
    },
    run_approved: {
      subject: 'Run approved – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + text('name', 'runner') + ', your run has been approved. Congratulations on completing the challenge.</p>'
        + raceCard(data) + '<p>Your certificate is ready in your RavenX dashboard.</p>' + emailButton(userUrl, 'View your certificate')
    },
    run_rejected: {
      subject: 'Run submission update – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + text('name', 'runner') + ', your run submission needs an update before it can be approved.</p>'
        + raceCard(data) + emailDetails([['Review feedback', data.feedback]])
        + '<p>You can submit an updated activity from your event dashboard.</p>' + emailButton(userUrl, 'Open My Events')
    },
    certificate_available: {
      subject: 'Certificate available – ' + (data.eventName || 'Shadow Sprint Run 2026'),
      html: '<p>Hi ' + text('name', 'runner') + ', your verified finisher certificate is ready. Take a moment to celebrate the work behind every mile.</p>'
        + raceCard(data) + emailButton(userUrl, 'Preview or download certificate')
    },
    password_reset: {
      subject: 'Set or reset your RavenX password',
      html: '<p>Use the secure one-time link below to set your password. It expires in 30 minutes.</p>' + emailButton(data.resetUrl, 'Set password')
    },
    password_reset_code: {
      subject: 'Your RavenX password reset code',
      html: '<p>We received a request to reset the password for your RavenX account. Enter this one-time code on the reset page:</p>'
        + '<div style="margin:22px 0;padding:20px 16px;background:#182b29;text-align:center;color:#fffaf2;font-size:34px;font-weight:900;letter-spacing:.28em">'
        + text('code') + '</div><p>This code can be used once and expires in 10 minutes.</p><p>If you did not request a password reset, you can ignore this email.</p>'
    },
    shop_order_admin: {
      subject: 'New RavenX shop order – ' + text('orderCode', 'New order'),
      html: '<p>A new shop order is ready for delivery processing.</p>' + emailDetails([
        ['Order', data.orderCode], ['Product', data.productName], ['Size', data.size], ['Quantity', data.quantity],
        ['Total', data.total === undefined ? '' : '৳' + data.total], ['Customer', data.name], ['Phone', data.phone],
        ['Email', data.email], ['District', data.district], ['Address', data.address]
      ]) + emailButton(base + '/#/admin/shop-orders', 'Review delivery order')
    },
    shop_order_received: {
      subject: 'RavenX received your jersey order – ' + text('orderCode', 'Order received'),
      html: '<p>Hi ' + text('name', 'there') + ', we received your RavenX shop order.</p>' + emailDetails([
        ['Order', data.orderCode], ['Product', data.productName], ['Size', data.size], ['Quantity', data.quantity],
        ['Total', data.total === undefined ? '' : '৳' + data.total]
      ]) + '<p>RavenX will contact you to confirm delivery and payment arrangements.</p>'
    }
  };
  const selected = templates[name];
  if (!selected) throw new Error('Unknown email template: ' + name);
  return { subject: selected.subject, html: emailLayout(selected.subject, selected.html, data) };
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
  if (email.template_name === 'password_reset_code' && !gmailConfigured) {
    throw new Error('The RavenX Gmail password-reset sender is not configured.');
  }
  if (gmailConfigured) {
    await gmailTransporter.sendMail({
      from: email.template_name === 'password_reset_code'
        ? 'RavenX <' + GMAIL_USER + '>'
        : EMAIL_FROM || 'RavenX <' + GMAIL_USER + '>',
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
      if (email.template_name === 'password_reset_code') {
        const validCode = email.payload?.tokenId
          ? await pool.query(
            'SELECT 1 FROM password_reset_tokens WHERE id=$1 AND used_at IS NULL AND expires_at>NOW()',
            [email.payload.tokenId]
          )
          : { rowCount: 0 };
        if (!validCode.rowCount) {
          await pool.query(
            "UPDATE email_outbox SET status='FAILED', payload='{}'::jsonb, locked_at=NULL, last_error=$2 WHERE id=$1",
            [email.id, 'Password reset code expired or was replaced before delivery.']
          );
          continue;
        }
      }
      await sendOne(email);
      await pool.query(
        "UPDATE email_outbox SET status=$2, payload=CASE WHEN template_name='password_reset_code' THEN '{}'::jsonb ELSE payload END, sent_at=NOW(), locked_at=NULL, last_error=NULL WHERE id=$1",
        [email.id, 'SENT']
      );
    } catch (error) {
      const attempts = Number(email.attempts || 0) + 1;
      const status = attempts >= 12 ? 'FAILED' : 'PENDING';
      const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
      await pool.query(
        "UPDATE email_outbox SET status=$2, payload=CASE WHEN $2='FAILED' AND template_name='password_reset_code' THEN '{}'::jsonb ELSE payload END, locked_at=NULL, last_error=$3, " +
        "next_attempt_at=NOW() + ($4::text || ' minutes')::interval WHERE id=$1",
        [email.id, status, String(error.message).slice(0, 500), delayMinutes]
      );
      console.error('Email delivery failed; queued for retry', { id: email.id, attempts, status });
    }
  }
}

module.exports = { ADMIN_EMAIL, emailConfigured: configured, enqueueEmail, processOutbox, template };

