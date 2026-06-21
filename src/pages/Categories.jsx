import { useState, useEffect } from 'react';
import { api } from '../api.js';

const COLOR_PRESETS = [
  '#22c55e', '#16a34a', '#f59e0b', '#ef4444', '#ec4899',
  '#8b5cf6', '#3b82f6', '#64748b', '#6b7280', '#9ca3af',
];

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', icon: '📁', color: '#9ca3af' });
  const [saving, setSaving] = useState(false);
  const [rulesFor, setRulesFor] = useState(null); // category being managed for rules

  const load = () => {
    setLoading(true);
    api.getCategories().then(setCategories).catch(err => setError(err.message)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm({ name: '', icon: '📁', color: '#9ca3af' });
    setShowAdd(false);
    setEditId(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError('');
    try {
      if (editId) {
        await api.updateCategory(editId, form);
      } else {
        await api.createCategory(form);
      }
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this category? Transactions will be moved to "Other".')) return;
    try {
      await api.deleteCategory(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSeed = async () => {
    try {
      await api.seedCategories();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleApplyRulesNow = async () => {
    try {
      const res = await api.applyRulesNow();
      alert(`Applied ${res.applied} categorization${res.applied === 1 ? '' : 's'}${res.message ? ' (' + res.message + ')' : ''}`);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="empty-state"><p><span className="spinner" /> Loading...</p></div>;

  return (
    <div>
      <div className="page-header">
        <h1>Categories</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleApplyRulesNow} title="Run all enabled rules against uncategorized transactions">
            ⚡ Apply All Rules
          </button>
          <button onClick={handleSeed}>Re-seed Defaults</button>
          <button className="primary" onClick={() => setShowAdd(true)}>+ Add Category</button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="card">
        {categories.length === 0 ? (
          <div className="empty-state">
            <p>No categories yet.</p>
            <button className="primary" onClick={handleSeed}>Seed Default Categories</button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Icon</th>
                <th>Name</th>
                <th>Color</th>
                <th>Default</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <tr key={cat.id}>
                  <td style={{ fontSize: '1.2rem' }}>{cat.icon}</td>
                  <td style={{ fontWeight: 500 }}>{cat.name}</td>
                  <td>
                    <span style={{
                      display: 'inline-block', width: 20, height: 20, borderRadius: 4,
                      background: cat.color, verticalAlign: 'middle',
                    }} />
                    <span style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {cat.color}
                    </span>
                  </td>
                  <td>{cat.is_default ? 'Yes' : ''}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setRulesFor(cat)} title="Manage auto-categorization rules">
                        ⚙ Rules
                      </button>
                      <button onClick={() => { setEditId(cat.id); setForm({ name: cat.name, icon: cat.icon, color: cat.color }); setShowAdd(true); }}>
                        Edit
                      </button>
                      <button className="danger" onClick={() => handleDelete(cat.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && resetForm()}>
          <div className="modal">
            <h2>{editId ? 'Edit Category' : 'Add Category'}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required autoFocus />
              </div>
              <div className="form-group">
                <label>Icon (emoji)</label>
                <input value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} placeholder="e.g. 🛒" maxLength={4} />
              </div>
              <div className="form-group">
                <label>Color</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {COLOR_PRESETS.map(c => (
                    <span key={c} onClick={() => setForm({ ...form, color: c })}
                      style={{
                        width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer',
                        border: form.color === c ? '3px solid var(--text)' : '2px solid transparent',
                        display: 'inline-block',
                      }} />
                  ))}
                  <input type="color" value={form.color}
                    onChange={e => setForm({ ...form, color: e.target.value })}
                    style={{ width: 40, height: 28, padding: 0, border: 'none', cursor: 'pointer' }} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={resetForm}>Cancel</button>
                <button type="submit" className="primary" disabled={saving}>
                  {saving ? <><span className="spinner" /> Saving...</> : (editId ? 'Update' : 'Add')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rulesFor && (
        <RulesModal
          category={rulesFor}
          onClose={() => { setRulesFor(null); load(); }}
        />
      )}
    </div>
  );
}

function RulesModal({ category, onClose }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({
    rule_type: 'keyword',
    match_text: '',
    account_ids: 'all',
    pattern_threshold: 0.6,
    priority: 0,
    enabled: true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.getRules().then(all => setRules(all.filter(r => r.category_id === category.id))).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.getAccounts().then(setAccounts).catch(() => {});
  }, [category.id]);

  const resetForm = () => {
    setForm({ rule_type: 'keyword', match_text: '', account_ids: 'all', pattern_threshold: 0.6, priority: 0, enabled: true });
    setShowAdd(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        category_id: category.id,
        rule_type: form.rule_type,
        account_ids: form.account_ids === 'all' ? 'all' : (Array.isArray(form.account_ids) ? form.account_ids : [form.account_ids].filter(Boolean)),
        pattern_threshold: form.pattern_threshold,
        priority: form.priority,
        enabled: form.enabled,
      };
      if (form.rule_type === 'keyword') {
        payload.match_text = form.match_text;
      }
      await api.createRule(payload);
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this rule?')) return;
    await api.deleteRule(id);
    load();
  };

  const handleToggle = async (rule) => {
    await api.updateRule(rule.id, { enabled: !rule.enabled });
    load();
  };

  const handlePreview = async (rule) => {
    const data = await api.previewRule(rule.id);
    setPreview({ rule, data });
  };

  const toggleAccount = (id) => {
    if (form.account_ids === 'all') {
      setForm({ ...form, account_ids: [id] });
    } else {
      const list = Array.isArray(form.account_ids) ? form.account_ids : [];
      if (list.includes(id)) {
        setForm({ ...form, account_ids: list.filter(x => x !== id) });
      } else {
        setForm({ ...form, account_ids: [...list, id] });
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720, width: '95%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ marginBottom: 4 }}>Rules for {category.icon} {category.name}</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          Auto-categorize new transactions when they match. Rules run after every sync.
        </p>

        {error && <div className="error-message">{error}</div>}

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
        {loading ? (
          <p><span className="spinner" /> Loading rules…</p>
        ) : rules.length === 0 ? (
          <div className="empty-state">
            <p>No rules yet for this category.</p>
            <button className="primary" onClick={() => setShowAdd(true)}>+ Add First Rule</button>
          </div>
        ) : (
          <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 16 }}>
            {rules.map(rule => (
              <div key={rule.id} style={{
                padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                    {rule.rule_type === 'keyword'
                      ? <>Match description containing <code style={{ background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4 }}>{rule.match_text}</code></>
                      : <>Match patterns from history ({rule.patterns?.length || 0} patterns)</>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {rule.account_ids === 'all' ? 'All accounts' : `${(Array.isArray(rule.account_ids) ? rule.account_ids : []).length} account(s)`}
                    {' · '}
                    Priority: {rule.priority}
                    {' · '}
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </div>
                </div>
                <button onClick={() => handlePreview(rule)}>Preview</button>
                <button onClick={() => handleToggle(rule)}>{rule.enabled ? 'Disable' : 'Enable'}</button>
                <button className="danger" onClick={() => handleDelete(rule.id)}>Delete</button>
              </div>
            ))}
          </div>
        )}

        {showAdd && (
          <div style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 'var(--radius)', marginBottom: 12 }}>
            <h3 style={{ marginBottom: 8 }}>New Rule</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Rule Type</label>
                <select value={form.rule_type} onChange={e => setForm({ ...form, rule_type: e.target.value })}>
                  <option value="keyword">Keyword — match a word/phrase in description</option>
                  <option value="history">History — auto-build patterns from existing transactions</option>
                </select>
              </div>

              {form.rule_type === 'keyword' && (
                <div className="form-group">
                  <label>Match Text</label>
                  <input value={form.match_text} onChange={e => setForm({ ...form, match_text: e.target.value })}
                    placeholder="e.g. STARBUCKS" required />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                    Case-insensitive, matches as a whole word.
                  </p>
                </div>
              )}

              {form.rule_type === 'history' && (
                <div className="form-group">
                  <label>Pattern Threshold</label>
                  <select value={form.pattern_threshold} onChange={e => setForm({ ...form, pattern_threshold: Number(e.target.value) })}>
                    <option value={0.4}>40% — lenient (more patterns)</option>
                    <option value={0.6}>60% — balanced (default)</option>
                    <option value={0.8}>80% — strict (fewer, more reliable patterns)</option>
                  </select>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                    Minimum % of category's transactions that must contain a pattern. Patterns will be auto-extracted.
                  </p>
                </div>
              )}

              <div className="form-group">
                <label>Apply to Accounts</label>
                <select
                  value={form.account_ids === 'all' ? 'all' : '__multi'}
                  onChange={e => {
                    if (e.target.value === 'all') {
                      setForm({ ...form, account_ids: 'all' });
                    } else {
                      // Switched to multi-select — show empty selection by default
                      setForm({ ...form, account_ids: [] });
                    }
                  }}
                  style={{ width: '100%' }}
                >
                  <option value="all">All accounts</option>
                  <option value="__multi">Specific accounts only…</option>
                </select>
                {form.account_ids !== 'all' && (
                  <select
                    multiple
                    value={Array.isArray(form.account_ids) ? form.account_ids.map(String) : []}
                    onChange={e => setForm({ ...form, account_ids: Array.from(e.target.selectedOptions).map(o => Number(o.value)) })}
                    style={{ width: '100%', height: 100, marginTop: 6 }}
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                )}
                {form.account_ids !== 'all' && Array.isArray(form.account_ids) && form.account_ids.length > 0 && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                    Selected: {form.account_ids.length} account{form.account_ids.length !== 1 ? 's' : ''} (hold Ctrl/Cmd to multi-select)
                  </p>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Priority</label>
                  <input type="number" value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>Higher = evaluated first.</p>
                </div>
                <div className="form-group">
                  <label>Enabled</label>
                  <select value={form.enabled ? 'yes' : 'no'} onChange={e => setForm({ ...form, enabled: e.target.value === 'yes' })}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" onClick={resetForm}>Cancel</button>
                <button type="submit" className="primary" disabled={saving}>
                  {saving ? <><span className="spinner" /> Saving...</> : 'Create Rule'}
                </button>
              </div>
            </form>
          </div>
        )}
        </div>

        <div className="modal-actions" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 8, flexShrink: 0 }}>
          {!showAdd && <button onClick={() => setShowAdd(true)}>+ Add Rule</button>}
          <button onClick={onClose}>Close</button>
        </div>

        {preview && (
          <div className="modal-overlay" onClick={() => setPreview(null)} style={{ zIndex: 200 }}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h3>Preview matches</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                {preview.data.match_count} transaction{preview.data.match_count !== 1 ? 's' : ''} would be categorized
                {preview.data.patterns?.length > 0 && ` using ${preview.data.patterns.length} pattern(s)`}.
              </p>
              {preview.data.matches.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>No uncategorized transactions match yet.</p>
              ) : (
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  <table>
                    <thead>
                      <tr><th>Date</th><th>Description</th><th>Account</th><th>Matched on</th></tr>
                    </thead>
                    <tbody>
                      {preview.data.matches.map(m => (
                        <tr key={m.id}>
                          <td style={{ fontSize: '0.8rem' }}>{new Date(m.posted + 'Z').toLocaleDateString()}</td>
                          <td style={{ fontSize: '0.85rem' }}>{m.description}</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{m.account_name}</td>
                          <td style={{ fontSize: '0.8rem' }}>
                            <code style={{ background: 'var(--surface-2)', padding: '1px 4px', borderRadius: 3 }}>{m.matched_on}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="modal-actions">
                <button onClick={() => setPreview(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
