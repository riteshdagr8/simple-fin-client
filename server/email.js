import { Resend } from 'resend';
import crypto from 'crypto';
import { getDb } from './db.js';
import { buildSummaryData } from './scheduler.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || 'FinApp <noreply@finapp.local>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

console.log(`[EMAIL] Resend configured: ${!!RESEND_API_KEY} | FROM: "${RESEND_FROM}" | APP_URL: "${APP_URL}"`);

let resend;

function getResend() {
  if (!resend) {
    if (!RESEND_API_KEY) {
      console.warn('Email not configured: RESEND_API_KEY env var not set. Emails will be logged to console.');
      return null;
    }
    resend = new Resend(RESEND_API_KEY);
  }
  return resend;
}

async function sendMail(to, subject, html) {
  const r = getResend();
  if (!r) {
    console.log(`[EMAIL] To: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g, '')}`);
    return Promise.resolve();
  }
  try {
    console.log(`[EMAIL] Sending email to ${to}: ${subject}`);
    const result = await r.emails.send({ from: RESEND_FROM, to, subject, html });
    if (result.error) {
      console.error(`[EMAIL] Resend error:`, result.error);
      throw new Error(result.error.message || 'Resend send failed');
    }
    console.log(`[EMAIL] Email sent successfully to ${to}, ID: ${result.data?.id}`);
    return result;
  } catch (err) {
    console.error(`[EMAIL] Failed to send email to ${to}:`, err.message);
    throw err;
  }
}

// Escape user-controlled values before inserting into HTML
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function sendVerificationEmail(email, name, token) {
  const safeName = escapeHtml(name);
  const url = `${APP_URL}/#/verify-email?token=${token}`;
  const html = `
    <p>Hi ${safeName},</p>
    <p>Welcome to FinApp! Please verify your email address by clicking the link below:</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link expires in 24 hours.</p>
    <p>If you didn't create an account, you can safely ignore this email.</p>
  `;
  await sendMail(email, 'Verify your FinApp email', html);
}

export async function sendResetEmail(email, name, token) {
  const safeName = escapeHtml(name);
  const url = `${APP_URL}/#/reset-password?token=${token}`;
  const html = `
    <p>Hi ${safeName},</p>
    <p>Click the link below to reset your password:</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link expires in 1 hour.</p>
    <p>If you didn't request a password reset, you can safely ignore this email.</p>
  `;
  await sendMail(email, 'Reset your FinApp password', html);
}

function formatCurrency(value, currency = 'USD') {
  const n = Number(value) || 0;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    const sign = n < 0 ? '-' : '';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildSummaryHtml(name, data, settings) {
  const safeName = escapeHtml(name);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const sections = [];

  if (settings.include_total_balance) {
    const { totalBalance = 0, accountCount = 0 } = data.balances || {};
    sections.push(`
      <h3 style="margin:24px 0 8px;color:#1f2937;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Total Balance</h3>
      <p style="margin:0;font-size:28px;font-weight:700;color:${totalBalance >= 0 ? '#059669' : '#dc2626'};">
        ${escapeHtml(formatCurrency(totalBalance))}
      </p>
      <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">
        Across ${accountCount} account${accountCount === 1 ? '' : 's'}
      </p>
    `);
  }

  if (settings.include_per_account_balance && data.accounts?.length) {
    const rows = data.accounts.map(a => `
      <tr>
        <td style="padding:8px 0;color:#1f2937;font-size:14px;">${escapeHtml(a.name)}</td>
        <td style="padding:8px 0;color:#6b7280;font-size:12px;">${escapeHtml(a.bank_name || a.connection_name || '')}</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;color:${a.balance >= 0 ? '#059669' : '#dc2626'};font-size:14px;">
          ${escapeHtml(formatCurrency(a.balance, a.currency))}
        </td>
      </tr>
    `).join('');
    sections.push(`
      <h3 style="margin:24px 0 8px;color:#1f2937;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Account Balances</h3>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    `);
  }

  if (settings.include_per_category_spending && data.categorySpending?.length) {
    const withSpending = data.categorySpending.filter(c => c.total < 0);
    if (withSpending.length) {
      const rows = withSpending.slice(0, 15).map(c => `
        <tr>
          <td style="padding:6px 0;color:#1f2937;font-size:14px;">
            <span style="margin-right:6px;">${escapeHtml(c.icon || '📁')}</span>${escapeHtml(c.name)}
          </td>
          <td style="padding:6px 0;text-align:right;font-weight:600;color:#dc2626;font-size:14px;">
            ${escapeHtml(formatCurrency(Math.abs(c.total)))}
          </td>
        </tr>
      `).join('');
      sections.push(`
        <h3 style="margin:24px 0 8px;color:#1f2937;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Spending by Category</h3>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      `);
    }
  }

  if (settings.include_todays_transactions) {
    const txns = data.todaysTransactions || [];
    if (txns.length) {
      const rows = txns.slice(0, 25).map(t => `
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:12px;white-space:nowrap;width:60px;">${escapeHtml(formatDate(t.posted))}</td>
          <td style="padding:6px 0;color:#1f2937;font-size:14px;overflow:hidden;text-overflow:ellipsis;">
            <div>${escapeHtml(t.description)}</div>
            <div style="color:#9ca3af;font-size:11px;">${escapeHtml(t.account_name || '')}</div>
          </td>
          <td style="padding:6px 0;text-align:right;white-space:nowrap;font-weight:600;color:${t.amount >= 0 ? '#059669' : '#dc2626'};font-size:14px;width:80px;">
            ${escapeHtml(formatCurrency(t.amount))}
          </td>
        </tr>
      `).join('');
      sections.push(`
        <h3 style="margin:24px 0 8px;color:#1f2937;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Today's Transactions</h3>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      `);
    } else {
      sections.push(`
        <h3 style="margin:24px 0 8px;color:#1f2937;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Today's Transactions</h3>
        <p style="margin:0;color:#6b7280;font-size:13px;font-style:italic;">No transactions today.</p>
      `);
    }
  }

  if (settings.include_weeks_transactions) {
    const txns = data.weeksTransactions || [];
    if (txns.length) {
      const rows = txns.slice(0, 25).map(t => `
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:12px;white-space:nowrap;width:60px;">${escapeHtml(formatDate(t.posted))}</td>
          <td style="padding:6px 0;color:#1f2937;font-size:14px;overflow:hidden;text-overflow:ellipsis;">
            <div>${escapeHtml(t.description)}</div>
            <div style="color:#9ca3af;font-size:11px;">${escapeHtml(t.account_name || '')}</div>
          </td>
          <td style="padding:6px 0;text-align:right;white-space:nowrap;font-weight:600;color:${t.amount >= 0 ? '#059669' : '#dc2626'};font-size:14px;width:80px;">
            ${escapeHtml(formatCurrency(t.amount))}
          </td>
        </tr>
      `).join('');
      sections.push(`
        <h3 style="margin:24px 0 8px;color:#1f2937;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">This Week's Transactions</h3>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      `);
    } else {
      sections.push(`
        <h3 style="margin:24px 0 8px;color:#1f2937;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">This Week's Transactions</h3>
        <p style="margin:0;color:#6b7280;font-size:13px;font-style:italic;">No transactions this week.</p>
      `);
    }
  }

  const settingsUrl = `${APP_URL}/#/settings`;

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937;background:#ffffff;">
      <h2 style="margin:0 0 4px;color:#111827;">FinApp Summary</h2>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">${today}</p>

      <p style="margin:0 0 16px;font-size:15px;">Hi ${safeName},</p>
      <p style="margin:0 0 24px;font-size:14px;color:#4b5563;line-height:1.5;">
        Here is your financial summary. You can change what is included in
        <a href="${settingsUrl}" style="color:#2563eb;">Settings</a>.
      </p>

      ${sections.join('')}

      <hr style="margin:32px 0 16px;border:none;border-top:1px solid #e5e7eb;" />
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        Sent by FinApp. <a href="${settingsUrl}" style="color:#9ca3af;">Manage email preferences</a>.
      </p>
    </div>
  `;
}

export async function sendSummaryEmail(userId) {
  const db = getDb();

  // Atomic claim: update last_sent_at and return whether we won the race.
  // This prevents duplicate emails when multiple server processes (e.g.
  // stale dev servers) each run runDueSummaries concurrently. The UPDATE
  // succeeds for exactly one process; the rest see changes === 0 and skip.
  const claim = db.prepare(`
    UPDATE email_summary_settings
    SET last_sent_at = datetime('now')
    WHERE user_id = ?
      AND enabled = 1
      AND (last_sent_at IS NULL
           OR datetime(last_sent_at, '+' || frequency_hours || ' hours') <= datetime('now'))
  `).run(userId);

  if (claim.changes === 0) return { skipped: 'already_claimed' };

  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId);
  if (!user) return { skipped: 'no_user' };
  if (!user.email) return { skipped: 'no_email' };

  const settings = db.prepare('SELECT * FROM email_summary_settings WHERE user_id = ?')
    .get(userId);

  const data = await buildSummaryData(userId, settings);
  const html = buildSummaryHtml(user.name || 'there', data, settings);

  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  await sendMail(user.email, `Your FinApp summary for ${today}`, html);

  return { sent: true, email: user.email };
}
