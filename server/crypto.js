import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit nonce, recommended for GCM
const AUTH_TAG_LEN = 16;

// Derive a 32-byte key from whatever the user provided in ENCRYPTION_KEY.
// Accepts either:
//   - 64 hex chars (32 raw bytes)
//   - any length string (hashed with SHA-256 to get 32 bytes)
function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" ' +
      'and add it to your .env file.'
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: enc:<base64(iv + tag + ciphertext)>
  return 'enc:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(encoded) {
  if (encoded == null || encoded === '') return encoded;
  if (typeof encoded !== 'string' || !encoded.startsWith('enc:')) {
    // Not encrypted (legacy plaintext) — return as-is
    return encoded;
  }
  const key = getKey();
  const buf = Buffer.from(encoded.slice(4), 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const data = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

// Mask a value for display: show last 4 chars only.
// Used for backwards-compatible display of the API key hint.
export function maskValue(value) {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return '••••' + value.slice(-4);
}
