import { useState, useEffect } from 'react';
import { api } from '../api.js';

const PROVIDERS = [
  { id: 'openai',    label: 'OpenAI',         defaultUrl: 'https://api.openai.com/v1',         defaultModel: 'gpt-4o-mini' },
  { id: 'anthropic', label: 'Claude (Anthropic)', defaultUrl: 'https://api.anthropic.com/v1',   defaultModel: 'claude-3-5-haiku-20241022' },
  { id: 'openrouter',label: 'OpenRouter',     defaultUrl: 'https://openrouter.ai/api/v1',       defaultModel: 'openai/gpt-4o-mini' },
  { id: 'custom',    label: 'Custom (OpenAI-compatible)', defaultUrl: '', defaultModel: '' },
];

export default function Settings({ setTheme }) {
  const [config, setConfig] = useState(null);
  const [provider, setProvider] = useState('openai');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [showCheckWarning, setShowCheckWarning] = useState(false);

  const [syncInterval, setSyncInterval] = useState(2);
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncSaved, setSyncSaved] = useState(false);

  const [theme, setLocalTheme] = useState('minimal');

  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailFrequency, setEmailFrequency] = useState(6);
  const [emailIncTotal, setEmailIncTotal] = useState(true);
  const [emailIncAccounts, setEmailIncAccounts] = useState(true);
  const [emailIncCategories, setEmailIncCategories] = useState(true);
  const [emailIncToday, setEmailIncToday] = useState(true);
  const [emailIncWeek, setEmailIncWeek] = useState(true);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailLastSent, setEmailLastSent] = useState(null);

  useEffect(() => {
    api.getLLMConfig()
      .then(cfg => {
        setConfig(cfg);
        if (cfg.hasKey) {
          setProvider(cfg.provider || 'openai');
          setBaseUrl(cfg.baseUrl || PROVIDERS.find(p => p.id === (cfg.provider || 'openai'))?.defaultUrl || '');
          setModel(cfg.model || 'gpt-4o-mini');
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
    api.getSyncSettings()
      .then(s => {
        setSyncInterval(s.sync_interval_hours || 2);
        setLocalTheme(s.ui_theme || 'minimal');
      })
      .catch(() => {});
    api.getEmailSummarySettings()
      .then(es => {
        setEmailEnabled(!!es.enabled);
        setEmailFrequency(es.frequency_hours || 6);
        setEmailIncTotal(!!es.include_total_balance);
        setEmailIncAccounts(!!es.include_per_account_balance);
        setEmailIncCategories(!!es.include_per_category_spending);
        setEmailIncToday(!!es.include_todays_transactions);
        setEmailIncWeek(!!es.include_weeks_transactions);
        setEmailLastSent(es.last_sent_at || null);
      })
      .catch(() => {});
  }, []);

  const handleProviderChange = (id) => {
    setProvider(id);
    const p = PROVIDERS.find(p => p.id === id);
    if (p) {
      if (id !== 'custom') setBaseUrl(p.defaultUrl);
      if (id !== 'custom') setModel(p.defaultModel);
    }
    setSaved(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        provider,
        baseUrl: baseUrl || PROVIDERS.find(p => p.id === provider)?.defaultUrl,
        model,
      };
      // Only send apiKey if user typed a new one
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      await api.saveLLMConfig(payload);
      setConfig(prev => ({ ...prev, hasKey: true }));
      setSaved(true);
      setApiKey(''); // Clear after successful save
      setCheckResult(null); // Clear any previous check
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const performCheck = async () => {
    setShowCheckWarning(false);
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await api.checkLLMModel();
      setCheckResult(result);
    } catch (err) {
      setCheckResult({ error: err.message });
    } finally {
      setChecking(false);
    }
  };

  const handleCheckClick = () => {
    if (!config?.hasKey) {
      setError('Save your LLM settings first (API key required).');
      return;
    }
    setShowCheckWarning(true);
  };

  const handleSyncSave = async (e) => {
    e.preventDefault();
    setSyncSaving(true);
    try {
      await api.saveSyncSettings({ sync_interval_hours: Number(syncInterval), ui_theme: theme });
      if (setTheme) setTheme(theme);
      setSyncSaved(true);
      setTimeout(() => setSyncSaved(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncSaving(false);
    }
  };

  const handleEmailSave = async (e) => {
    e.preventDefault();
    setError('');
    if (emailEnabled) {
      const freq = Number(emailFrequency);
      if (!Number.isInteger(freq) || freq < 1 || freq > 24) {
        setError('Frequency must be an integer between 1 and 24 hours.');
        return;
      }
    }
    setEmailSaving(true);
    try {
      await api.saveEmailSummarySettings({
        enabled: !!emailEnabled,
        frequency_hours: Number(emailFrequency) || 6,
        include_total_balance: !!emailIncTotal,
        include_per_account_balance: !!emailIncAccounts,
        include_per_category_spending: !!emailIncCategories,
        include_todays_transactions: !!emailIncToday,
        include_weeks_transactions: !!emailIncWeek,
      });
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setEmailSaving(false);
    }
  };

  const themePreview = (id) => ({
    minimal: 'Subtle grays, sharp edges, focus on data.',
    colorful: 'Vibrant gradients, rounded cards, expressive typography.',
  })[id];

  if (loading) return <div className="empty-state"><p><span className="spinner" /> Loading...</p></div>;

  return (
    <div>
      <h1>Settings</h1>

      <div className="card">
        <h2>LLM Configuration</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>
          Configure an LLM provider to enable AI-powered auto-categorization of transactions.
          Your API key is stored locally and never sent to any server other than the provider you configure.
        </p>

        {error && <div className="error-message">{error}</div>}
        {saved && (
          <div style={{ background: '#f0fdf4', color: 'var(--success)', padding: '10px 14px', borderRadius: 'var(--radius)', marginBottom: 16, fontSize: '0.85rem' }}>
            Settings saved successfully!
          </div>
        )}

        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>Provider</label>
            <select value={provider} onChange={e => handleProviderChange(e.target.value)}>
              {PROVIDERS.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          {provider === 'custom' && (
            <div className="form-group">
              <label>Base URL</label>
              <input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://your-ollama-server.com/v1" />
            </div>
          )}

          <div className="form-group">
            <label>API Key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder={config?.hasKey ? '(unchanged — current key hidden)' : 'Enter your API key'} />
          </div>

          <div className="form-group">
            <label>Model</label>
            <input type="text" value={model} onChange={e => setModel(e.target.value)}
              placeholder="e.g. gpt-4o-mini" />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              {provider === 'openai' && 'Recommended: gpt-4o-mini (fast, cheap, accurate)'}
              {provider === 'anthropic' && 'Recommended: claude-3-5-haiku-20241022 (fast, accurate)'}
              {provider === 'openrouter' && 'Try: openai/gpt-4o-mini or anthropic/claude-3-haiku'}
              {provider === 'custom' && 'Enter the model name your server uses (e.g. llama3, gpt-4o-mini)'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Saving...</> : 'Save LLM Settings'}
            </button>
            <button type="button" onClick={handleCheckClick} disabled={checking || !config?.hasKey} title={!config?.hasKey ? 'Save settings first' : 'Test if this model is reasoning or non-reasoning'}>
              {checking ? <><span className="spinner" /> Checking...</> : '🔍 Check Model'}
            </button>
          </div>
        </form>

        {checkResult && !checkResult.error && (
          <div style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 'var(--radius)',
            border: `1px solid ${checkResult.isReasoning ? 'var(--warning)' : checkResult.isBroken ? 'var(--danger)' : 'var(--success)'}`,
            background: checkResult.isReasoning ? '#fffbeb' : checkResult.isBroken ? '#fef2f2' : '#f0fdf4',
            fontSize: '0.85rem',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: checkResult.isReasoning ? 'var(--warning)' : checkResult.isBroken ? 'var(--danger)' : 'var(--success)' }}>
              {checkResult.isReasoning ? '⚠️ Reasoning Model Detected' : checkResult.isBroken ? '❌ Model is Broken' : '✅ Non-Reasoning Model'}
            </div>
            <div style={{ marginBottom: 6 }}>{checkResult.verdict}</div>
            {checkResult.recommendation && (
              <div style={{ color: 'var(--text-secondary)' }}>💡 {checkResult.recommendation}</div>
            )}
            {(checkResult.content || checkResult.reasoning) && (
              <details style={{ marginTop: 8, fontSize: '0.8rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>Show raw response</summary>
                <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: '0.75rem', background: 'rgba(0,0,0,0.04)', padding: 8, borderRadius: 4, wordBreak: 'break-all' }}>
                  {checkResult.content && <div><strong>content:</strong> {checkResult.content}</div>}
                  {checkResult.reasoning && <div><strong>reasoning_content:</strong> {checkResult.reasoning}</div>}
                  {checkResult.finish_reason && <div><strong>finish_reason:</strong> {checkResult.finish_reason}</div>}
                  {checkResult.model && <div><strong>model:</strong> {checkResult.model}</div>}
                </div>
              </details>
            )}
          </div>
        )}

        {checkResult && checkResult.error && (
          <div className="error-message" style={{ marginTop: 16 }}>
            <strong>Check failed:</strong> {checkResult.error}
          </div>
        )}

        {showCheckWarning && (
          <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowCheckWarning(false)}>
            <div className="modal">
              <h2>Check Model</h2>
              <p style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>
                This will send a small test request to the LLM to determine whether it's a reasoning model.
                Most providers charge a small amount of tokens for this — typically well under 100 tokens.
              </p>
              <p style={{ marginBottom: 16, fontSize: '0.85rem' }}>
                <strong>Cost note:</strong> Reasoning models may use more tokens than non-reasoning models
                for the same test, since they "think" before responding. The check itself does not perform
                any categorization — it just sends a single "respond with only: ok" prompt.
              </p>
              <div style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 'var(--radius)', marginBottom: 16, fontSize: '0.8rem' }}>
                <div><strong>Provider:</strong> {provider}</div>
                <div><strong>Model:</strong> {model || '(not set)'}</div>
                <div><strong>Base URL:</strong> {baseUrl || PROVIDERS.find(p => p.id === provider)?.defaultUrl}</div>
              </div>
              <div className="modal-actions">
                <button onClick={() => setShowCheckWarning(false)}>Cancel</button>
                <button className="primary" onClick={performCheck}>Run Check</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Sync Schedule</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>
          Choose how often to automatically sync your transactions. SimpleFIN allows a maximum of 24 syncs per
          connection per 24 hours, so shorter intervals reduce the number of manual syncs you can perform.
        </p>

        {syncSaved && (
          <div style={{ background: '#f0fdf4', color: 'var(--success)', padding: '10px 14px', borderRadius: 'var(--radius)', marginBottom: 16, fontSize: '0.85rem' }}>
            Sync settings saved!
          </div>
        )}

        <form onSubmit={handleSyncSave}>
          <div className="form-group">
            <label>Auto-sync interval (hours)</label>
            <select value={syncInterval} onChange={e => setSyncInterval(Number(e.target.value))}>
              <option value={1}>Every 1 hour (max — uses 24/day on its own)</option>
              <option value={2}>Every 2 hours (default — uses 12/day)</option>
              <option value={3}>Every 3 hours</option>
              <option value={4}>Every 4 hours</option>
              <option value={6}>Every 6 hours</option>
              <option value={8}>Every 8 hours</option>
              <option value={12}>Every 12 hours</option>
              <option value={24}>Every 24 hours</option>
            </select>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              Manual syncs share the same 24/day limit. With 1-hour auto-sync you'll have 0 manual syncs left; with 2-hour you'll have 12.
            </p>
          </div>

          <button type="submit" className="primary" disabled={syncSaving}>
            {syncSaving ? <><span className="spinner" /> Saving...</> : 'Save Sync Settings'}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Appearance</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>
          Choose how the app looks. Changes apply immediately when you click Save.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          {[
            { id: 'minimal', label: 'Modern Minimal', sample: { bg: '#f5f5f5', surface: '#ffffff', accent: '#2563eb' } },
            { id: 'colorful', label: 'Bold Colorful', sample: { bg: 'linear-gradient(135deg, #fef3c7, #fce7f3, #dbeafe)', surface: '#ffffff', accent: 'linear-gradient(135deg, #7c3aed, #ec4899)' } },
          ].map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setLocalTheme(opt.id)}
              style={{
                padding: 16,
                border: theme === opt.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                background: opt.sample.bg,
                textAlign: 'left',
                cursor: 'pointer',
                color: '#1a1a1a',
                boxShadow: theme === opt.id ? '0 0 0 3px var(--accent-soft)' : 'none',
              }}
            >
              <div style={{ background: opt.sample.surface, padding: 8, borderRadius: 6, marginBottom: 8, border: '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ height: 6, width: 40, background: typeof opt.sample.accent === 'string' && opt.sample.accent.startsWith('linear') ? opt.sample.accent : opt.sample.accent, borderRadius: 3, marginBottom: 6 }} />
                <div style={{ height: 4, width: '70%', background: '#e5e7eb', borderRadius: 2, marginBottom: 4 }} />
                <div style={{ height: 4, width: '50%', background: '#e5e7eb', borderRadius: 2 }} />
              </div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                {opt.label} {theme === opt.id && '✓'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#4b5563', marginTop: 2 }}>
                {themePreview(opt.id)}
              </div>
            </button>
          ))}
        </div>

        <button type="button" className="primary" onClick={async () => {
          if (setTheme) setTheme(theme);
          try {
            await api.saveSyncSettings({ ui_theme: theme });
          } catch (err) { setError(err.message); }
        }}>
          Apply Theme
        </button>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Email Summary</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>
          Receive periodic email summaries of your finances. Emails are sent to your account email.
          {emailLastSent && (
            <> Last sent: <span style={{ color: 'var(--text)' }}>{new Date(emailLastSent + 'Z').toLocaleString()}</span>.</>
          )}
        </p>

        {emailSaved && (
          <div style={{ background: '#f0fdf4', color: 'var(--success)', padding: '10px 14px', borderRadius: 'var(--radius)', marginBottom: 16, fontSize: '0.85rem' }}>
            Email summary settings saved!
          </div>
        )}

        <form onSubmit={handleEmailSave}>
          <div className="form-group">
            <label className="checkbox-row">
              <input type="checkbox" checked={emailEnabled}
                onChange={e => setEmailEnabled(e.target.checked)} />
              <span>Enable email summaries</span>
            </label>
          </div>

          {emailEnabled && (
            <>
              <div className="form-group">
                <label>Frequency (hours)</label>
                <input type="number" min={1} max={24} step={1}
                  value={emailFrequency}
                  onChange={e => setEmailFrequency(e.target.value)} />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  How often to send summaries. Enter a whole number between 1 and 24.
                  The server checks for due summaries every 5 minutes, so a 1-hour setting
                  may send up to 5 minutes past the hour.
                </p>
              </div>

              <p style={{ fontWeight: 600, margin: '16px 0 8px' }}>Include in summary:</p>

              <div className="form-group">
                <label className="checkbox-row">
                  <input type="checkbox" checked={emailIncTotal}
                    onChange={e => setEmailIncTotal(e.target.checked)} />
                  <span>Total balance across all accounts</span>
                </label>
              </div>
              <div className="form-group">
                <label className="checkbox-row">
                  <input type="checkbox" checked={emailIncAccounts}
                    onChange={e => setEmailIncAccounts(e.target.checked)} />
                  <span>Per-account balance breakdown</span>
                </label>
              </div>
              <div className="form-group">
                <label className="checkbox-row">
                  <input type="checkbox" checked={emailIncCategories}
                    onChange={e => setEmailIncCategories(e.target.checked)} />
                  <span>Spending by category</span>
                </label>
              </div>
              <div className="form-group">
                <label className="checkbox-row">
                  <input type="checkbox" checked={emailIncToday}
                    onChange={e => setEmailIncToday(e.target.checked)} />
                  <span>Today's transactions</span>
                </label>
              </div>
              <div className="form-group">
                <label className="checkbox-row">
                  <input type="checkbox" checked={emailIncWeek}
                    onChange={e => setEmailIncWeek(e.target.checked)} />
                  <span>This week's transactions</span>
                </label>
              </div>
            </>
          )}

          <button type="submit" className="primary" disabled={emailSaving}>
            {emailSaving ? <><span className="spinner" /> Saving...</> : 'Save Email Settings'}
          </button>
        </form>
      </div>
    </div>
  );
}
