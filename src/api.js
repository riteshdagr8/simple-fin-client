const BASE = '/api';
let authToken = null;

export function setToken(token) { authToken = token; }
export function getToken() { return authToken; }
export function clearToken() { authToken = null; }

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, { headers, ...options });
  if (res.status === 401) {
    clearToken();
    localStorage.removeItem('finapp_token');
    window.location.hash = '#/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Auth
  register: (name, email, password) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  verifyEmail: (token) =>
    request('/auth/verify', { method: 'POST', body: JSON.stringify({ token }) }),
  forgotPassword: (email) =>
    request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  me: () => request('/auth/me'),

  // Dashboard
  getDashboard: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, v));
    return request(`/dashboard${qs.toString() ? `?${qs}` : ''}`);
  },

  // Connections
  getConnections: () => request('/connections'),
  createConnection: (name, setupToken) =>
    request('/connections', { method: 'POST', body: JSON.stringify({ name, setupToken }) }),
  deleteConnection: (id) => request(`/connections/${id}`, { method: 'DELETE' }),
  syncConnection: (id) => request(`/connections/${id}/sync`, { method: 'POST' }),
  deepSyncConnection: (id) => request(`/connections/${id}/deep-sync`, { method: 'POST' }),
  resetConnection: (id) => request(`/connections/${id}/reset`, { method: 'POST' }),
  reauthenticateConnection: (id, setupToken) =>
    request(`/connections/${id}/reauthenticate`, { method: 'PUT', body: JSON.stringify({ setupToken }) }),

  // Accounts
  getAccounts: (connectionId, includeHidden = false) =>
    request(`/accounts?${new URLSearchParams({
      ...(connectionId ? { connection_id: connectionId } : {}),
      ...(includeHidden ? { include_hidden: 'true' } : {}),
    })}`),
  getAccountTransactions: (id, limit = 100, offset = 0) =>
    request(`/accounts/${id}/transactions?limit=${limit}&offset=${offset}`),
  importAccountTransactions: (id, rows) =>
    request(`/accounts/${id}/transactions/import`, { method: 'POST', body: JSON.stringify({ rows }) }),
  updateAccountBankName: (id, bank_name) =>
    request(`/accounts/${id}/bank-name`, { method: 'PUT', body: JSON.stringify({ bank_name }) }),
  updateAccountName: (id, name) =>
    request(`/accounts/${id}/name`, { method: 'PUT', body: JSON.stringify({ name }) }),
  updateAccountHidden: (id, is_hidden) =>
    request(`/accounts/${id}/hidden`, { method: 'PUT', body: JSON.stringify({ is_hidden }) }),
  bulkUpdateBankNames: (updates) =>
    request('/accounts/bulk-bank-name', { method: 'PUT', body: JSON.stringify({ updates }) }),
  bulkUpdateAccountNames: (updates) =>
    request('/accounts/bulk-name', { method: 'PUT', body: JSON.stringify({ updates }) }),

  // Transactions
  getTransactions: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, v));
    return request(`/transactions?${qs}`);
  },
  categorizeTransaction: (id, categoryId) =>
    request(`/transactions/${id}/categorize`, {
      method: 'POST', body: JSON.stringify({ categoryId, source: 'manual' }),
    }),
  bulkCategorizeTransactions: (transaction_ids, category_id) =>
    request('/transactions/bulk-categorize', {
      method: 'POST', body: JSON.stringify({ transaction_ids, category_id }),
    }),
  categorizeWithLLM: (params = {}) =>
    request('/transactions/categorize-llm', { method: 'POST', body: JSON.stringify(params) }),
  getLatestCategorizeJob: () => request('/transactions/categorize-jobs/latest'),
  dismissCategorizeJob: (id) =>
    request(`/transactions/categorize-jobs/${id}/dismiss`, { method: 'POST' }),
  getUncategorizedCount: () => request('/transactions/uncategorized-count'),

  // Categories
  getCategories: () => request('/categories'),
  createCategory: (data) =>
    request('/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id, data) =>
    request(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),
  seedCategories: () => request('/categories/seed', { method: 'POST' }),

  // Rules
  getRules: () => request('/rules'),
  createRule: (data) => request('/rules', { method: 'POST', body: JSON.stringify(data) }),
  updateRule: (id, data) => request(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRule: (id) => request(`/rules/${id}`, { method: 'DELETE' }),
  previewRule: (id) => request(`/rules/${id}/preview`),
  applyRulesNow: () => request('/rules/apply-now', { method: 'POST' }),

  // Settings
  getLLMConfig: () => request('/settings/llm'),
  saveLLMConfig: (data) =>
    request('/settings/llm', { method: 'PUT', body: JSON.stringify(data) }),
  checkLLMModel: () => request('/settings/llm/check', { method: 'POST' }),
  getSyncSettings: () => request('/settings/sync'),
  saveSyncSettings: (data) =>
    request('/settings/sync', { method: 'PUT', body: JSON.stringify(data) }),
  getEmailSummarySettings: () => request('/settings/email-summary'),
  saveEmailSummarySettings: (data) =>
    request('/settings/email-summary', { method: 'PUT', body: JSON.stringify(data) }),

  // Receipts
  getReceipts: () => request('/receipts'),
  getReceipt: (id) => request(`/receipts/${id}`),
  uploadReceipt: (formData) => {
    const headers = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return fetch(`${BASE}/receipts/upload`, {
      method: 'POST',
      headers,
      body: formData,
    }).then(res => {
      if (!res.ok) return res.json().then(body => { throw new Error(body.error || `HTTP ${res.status}`); });
      return res.json();
    });
  },
  matchReceipt: (id, transactionId) =>
    request(`/receipts/${id}/match`, { method: 'POST', body: JSON.stringify({ transaction_id: transactionId }) }),
  unmatchReceipt: (id) =>
    request(`/receipts/${id}/match`, { method: 'POST', body: JSON.stringify({ transaction_id: null }) }),
  rematchReceipt: (id, opts = {}) => request(`/receipts/${id}/rematch${opts.reextract ? '?reextract=1' : ''}`, { method: 'POST' }),
  getReceiptCandidates: (id) => request(`/receipts/${id}/candidates`),
  deleteReceipt: (id) => request(`/receipts/${id}`, { method: 'DELETE' }),
  deleteReceiptFile: (id) => request(`/receipts/${id}/file`, { method: 'DELETE' }),
  // Returns a blob URL (object URL) for the receipt file. Caller is responsible
  // for revoking it with URL.revokeObjectURL when no longer needed.
  // We can't use a direct src= because <img>/<a> can't send Authorization headers.
  getReceiptFile: async (id) => {
    const res = await fetch(`${BASE}/receipts/${id}/file`, {
      headers: { 'Authorization': `Bearer ${authToken || ''}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  // Backup
  downloadBackup: async () => {
    const res = await fetch(`${BASE}/backup/download`, {
      headers: { 'Authorization': `Bearer ${authToken || ''}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disposition = res.headers.get('Content-Disposition');
    const match = disposition && disposition.match(/filename="?(.+?)"?$/);
    a.download = match ? match[1] : `simplefin-backup-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
