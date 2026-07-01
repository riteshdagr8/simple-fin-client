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
  const [useLlmForReceipts, setUseLlmForReceipts] = useState(false);
  const [supportsVision, setSupportsVision] = useState(null); // null = auto-detect

  const [syncInterval, setSyncInterval] = useState(2);
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncSaved, setSyncSaved] = useState(false);

  const [theme, setLocalTheme] = useState('cloud');

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
          setUseLlmForReceipts(!!cfg.useLlmForReceipts);
          setSupportsVision(cfg.supportsVision);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
    api.getSyncSettings()
      .then(s => {
        setSyncInterval(s.sync_interval_hours || 2);
        setLocalTheme(s.ui_theme || 'cloud');
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
        useLlmForReceipts,
        supportsVision,
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

          <div className="form-group">
            <label className="checkbox-row">
              <input type="checkbox" checked={useLlmForReceipts}
                onChange={e => setUseLlmForReceipts(e.target.checked)} />
              <span>Use LLM for receipt extraction and matching</span>
            </label>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, marginLeft: 24 }}>
              When enabled, the LLM will extract total, vendor, and date from receipts, then help match to transactions.
              Uses additional API calls per receipt.
            </p>
            {useLlmForReceipts && (() => {
              const visionModels = ['gpt-4o', 'gpt-4-turbo', 'claude-3', 'claude-sonnet', 'claude-opus', 'gemini', 'qwen'];
              const autoVision = model ? visionModels.some(v => model.toLowerCase().includes(v)) : false;
              const isVision = supportsVision === true || (supportsVision === null && autoVision);

              return (
                <div style={{ marginTop: 6, marginLeft: 24 }}>
                  <label className="checkbox-row" style={{ fontSize: '0.8rem' }}>
                    <input type="checkbox"
                      checked={isVision}
                      onChange={e => {
                        if (e.target.checked) {
                          setSupportsVision(true);
                        } else {
                          setSupportsVision(false);
                        }
                      }} />
                    <span>Model supports vision (image input)</span>
                  </label>
                  {!isVision && model && (
                    <p style={{ fontSize: '0.75rem', color: '#ca8a04', marginTop: 4, background: '#fef9c3', padding: '6px 10px', borderRadius: 'var(--radius)' }}>
                      Receipt extraction will use OCR text instead of images. Check the box above if your model actually supports vision.
                    </p>
                  )}
                  {isVision && !autoVision && (
                    <p style={{ fontSize: '0.75rem', color: '#2563eb', marginTop: 4, background: '#dbeafe', padding: '6px 10px', borderRadius: 'var(--radius)' }}>
                      Vision manually enabled for <strong>{model}</strong>. Images will be sent to the model for extraction.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Saving...</> : 'Save LLM Settings'}
            </button>
            <button type="button" onClick={handleCheckClick} disabled={checking || !config?.hasKey} title={!config?.hasKey ? 'Save settings first' : 'Verify the model is reachable and responds correctly'}>
              {checking ? <><span className="spinner" /> Checking...</> : '🔍 Check Model'}
            </button>
          </div>
        </form>

        {checkResult && !checkResult.error && (
          <div style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 'var(--radius)',
            border: `1px solid ${checkResult.ok ? 'var(--success)' : 'var(--danger)'}`,
            background: checkResult.ok ? '#f0fdf4' : '#fef2f2',
            fontSize: '0.85rem',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: checkResult.ok ? 'var(--success)' : 'var(--danger)' }}>
              {checkResult.ok ? '✅ ' : '❌ '}{checkResult.verdict}
            </div>
            <div style={{ marginBottom: 6 }}>{checkResult.detail}</div>
            {checkResult.content && (
              <details style={{ marginTop: 8, fontSize: '0.8rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>Show raw response</summary>
                <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: '0.75rem', background: 'rgba(0,0,0,0.04)', padding: 8, borderRadius: 4, wordBreak: 'break-all' }}>
                  <div><strong>content:</strong> {checkResult.content}</div>
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
                This sends a small test prompt to your LLM to verify the model is reachable, your API key is
                valid, and the model can follow a simple instruction. The categorizer in this app works
                with both reasoning and non-reasoning models, so the check is just a smoke test of the
                configuration.
              </p>
              <p style={{ marginBottom: 16, fontSize: '0.85rem' }}>
                <strong>Cost note:</strong> The check sends a single short prompt (typically well under
                100 tokens) and uses the same provider/model as your categorizer.
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

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, auto)',
          gap: 10,
          marginBottom: 16,
        }}>
          {[
            {
              id: 'emerald',
              swatches: ['#0d6b3e', '#4a9e6a', '#8fbf6a', '#c9a84c', '#f5f0e0'],
            },
            {
              id: 'midnight',
              swatches: ['#0f111a', '#1a1d2e', '#4a4e8a', '#7c3aed', '#a78bfa'],
            },
            {
              id: 'ember',
              swatches: ['#141414', '#2a2a2a', '#555555', '#d96c1a', '#f5a060'],
            },
            {
              id: 'noir',
              swatches: ['#0a0a0a', '#323232', '#666666', '#c9a84c', '#e8d48b'],
            },
            {
              id: 'cloud',
              swatches: ['#ffffff', '#e0e4ea', '#94a3b8', '#64748b', '#3b82f6'],
            },
            {
              id: 'ocean',
              swatches: ['#0f1a2e', '#0d5e5e', '#0d8b8b', '#5ecfcf', '#a8e6e6'],
            },
          ].map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setLocalTheme(opt.id)}
              style={{
                padding: 16,
                borderRadius: 'var(--radius-lg)',
                border: theme === opt.id ? '2px solid var(--accent)' : '2px solid transparent',
                background: theme === opt.id ? 'var(--accent-soft)' : 'var(--surface)',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--text)',
                boxShadow: theme === opt.id
                  ? '0 0 0 1px var(--accent), 0 4px 12px var(--accent-soft)'
                  : '0 1px 3px rgba(0,0,0,0.06)',
                position: 'relative',
                transition: 'all 0.15s ease',
                outline: 'none',
              }}
            >
              {/* Checkmark for selected */}
              {theme === opt.id && (
                <div style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  lineHeight: 1,
                }}>
                  ✓
                </div>
              )}

              {/* Swatch row */}
              <div style={{
                display: 'flex',
                gap: 6,
              }}>
                {opt.swatches.map((color, i) => (
                  <div
                    key={i}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: color,
                      border: color === '#ffffff' ? '1px solid #d0d5dd' : 'none',
                      flexShrink: 0,
                    }}
                  />
                ))}
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
