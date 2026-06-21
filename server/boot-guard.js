// Guard against running the app with weak / default secrets.

export const DEFAULT_JWT_SECRET = 'finapp-dev-secret-change-in-production';
export const DEFAULT_ENCRYPTION_KEY = ''; // no default — must be set

// Throw if a secret is missing or matches the well-known default.
// `allowDefault = false` makes the secret strictly required.
export function ensureSecret(name, defaultValue, allowDefault = false) {
  const value = process.env[name];

  if (!value || value.length === 0) {
    throw new Error(
      `\n\n${name} is not set. ` +
      (defaultValue
        ? `If you don't have one, you can set a temporary value but the app will reject default values.\n`
        : `Set it in your .env file.\n`) +
      `Generate a strong value: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"\n`
    );
  }

  if (!allowDefault && value === defaultValue) {
    throw new Error(
      `\n\n${name} is set to the well-known default value. ` +
      `This is a security risk — anyone with access to this codebase can forge authentication tokens.\n` +
      `Generate a new value: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"\n` +
      `Update your .env file with the new value.\n`
    );
  }
}
