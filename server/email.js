import nodemailer from 'nodemailer';
import crypto from 'crypto';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'FinApp <noreply@finapp.local>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

console.log(`[EMAIL] SMTP_USER: "${SMTP_USER}" | SMTP_HOST: "${SMTP_HOST}" | APP_URL: "${APP_URL}"`);

let transporter;

function getTransporter() {
  if (!transporter) {
    if (!SMTP_USER || !SMTP_PASS) {
      console.warn('Email not configured: SMTP_USER and SMTP_PASS env vars not set. Emails will be logged to console.');
      return null;
    }
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

function sendMail(to, subject, html) {
  const tp = getTransporter();
  if (!tp) {
    console.log(`[EMAIL] To: ${to}\nSubject: ${subject}\n${html.replace(/<[^>]+>/g, '')}`);
    return Promise.resolve();
  }
  return tp.sendMail({ from: SMTP_FROM, to, subject, html });
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
