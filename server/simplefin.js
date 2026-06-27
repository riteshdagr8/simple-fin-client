export class SimpleFinAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SimpleFinAuthError';
    this.status = status;
  }
}

function buildClaimUrl(decoded) {
  // If it's already a valid URL, use it as-is
  if (/^https?:\/\//.test(decoded)) return decoded;
  // SimpleFIN demo tokens and some installations use a token ID format
  // The demo server is at beta-bridge.simplefin.org
  // First try the host implied by the token, default to beta-bridge
  return `https://beta-bridge.simplefin.org/simplefin/claim/${decoded}`;
}

async function claimAccessUrl(setupToken) {
  const decoded = Buffer.from(setupToken, 'base64').toString('utf8').trim();
  const claimUrl = buildClaimUrl(decoded);
  const response = await fetch(claimUrl, {
    method: 'POST',
    headers: { 'Content-Length': '0' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to claim access token: ${response.status} ${response.statusText} — ${body}`);
  }
  return response.text();
}

function parseAccessUrl(url) {
  const text = url.trim();
  if (!text) throw new Error('Empty access URL returned from claim');

  // If not a full URL, it may be a token-only response from demo/dev
  if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(text)) {
    throw new Error(
      `SimpleFIN returned an unrecognized access URL format. This may be a demo/dev token response ` +
      `that cannot be used for data access. Use a real Setup Token from SimpleFIN Bridge. ` +
      `Raw: ${text.substring(0, 80)}`
    );
  }

  const u = new URL(text);
  const username = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  if (!username || !password) {
    throw new Error('Access URL is missing credentials. The token may have already been claimed.');
  }
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  return { baseUrl, username, password };
}

function authHeader(username, password) {
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

export async function exchangeToken(setupToken) {
  const accessUrl = await claimAccessUrl(setupToken);
  const parsed = parseAccessUrl(accessUrl);
  return { accessUrl, ...parsed };
}

export async function fetchAccounts(accessUrl, startDate) {
  const { baseUrl, username, password } = parseAccessUrl(accessUrl);
  const auth = authHeader(username, password);
  const params = new URLSearchParams({ version: '2' });
  if (startDate) {
    params.set('start-date', String(startDate));
  }
  const url = `${baseUrl}/accounts?${params}`;
  const response = await fetch(url, { headers: { Authorization: auth } });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new SimpleFinAuthError(
        `SimpleFIN authentication failed (${response.status}): ${text}`,
        response.status
      );
    }
    throw new Error(`Failed to fetch accounts: ${response.status} ${response.statusText} — ${text}`);
  }
  const data = await response.json();

  if (data.errors && data.errors.length > 0) {
    console.warn('SimpleFIN warnings:', data.errors);
  }
  if (data.errlist && data.errlist.length > 0) {
    console.warn('SimpleFIN errors:', data.errlist);
  }

  return data;
}
