import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { api } from '../api.js';

function normalizeDateClient(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    const date = new Date(Date.UTC(+y, +mo - 1, +d));
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mo, d, y] = m;
    const date = new Date(Date.UTC(+y, +mo - 1, +d));
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }
  return null;
}

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingType, setEditingType] = useState(null); // 'bank' | 'name'
  const [editingValue, setEditingValue] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkBank, setBulkBank] = useState('');
  const [bulkName, setBulkName] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  // Bulk CSV import state
  const [showImport, setShowImport] = useState(false);
  const [importAccountId, setImportAccountId] = useState('');
  const [importRows, setImportRows] = useState([]); // parsed+validated rows ready to send
  const [importPreview, setImportPreview] = useState([]); // first 20 of importRows
  const [importInvalid, setImportInvalid] = useState([]); // {row, reason}
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
  };

  const sortedAccounts = [...accounts].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];
    if (sortBy === 'bank_name') {
      aVal = a.bank_name || a.connection_name || '';
      bVal = b.bank_name || b.connection_name || '';
    }
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    if (aVal == null) aVal = sortBy === 'balance' ? 0 : '';
    if (bVal == null) bVal = sortBy === 'balance' ? 0 : '';
    return sortDir === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
  });

  const SortHeader = ({ column, children, style }) => (
    <th
      onClick={() => handleSort(column)}
      style={{ cursor: 'pointer', userSelect: 'none', ...style }}
      title="Click to sort"
    >
      {children} {sortBy === column && (sortDir === 'asc' ? '▲' : '▼')}
    </th>
  );

  useEffect(() => {
    loadAccounts();
  }, [showHidden]);

  const loadAccounts = () => {
    setLoading(true);
    api.getAccounts(null, showHidden)
      .then(setAccounts)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  const startEdit = (acct, type) => {
    setEditingId(acct.id);
    setEditingType(type);
    setEditingValue(type === 'bank' ? (acct.bank_name || '') : (acct.name || ''));
  };

  const saveEdit = async (acctId) => {
    try {
      if (editingType === 'bank') {
        await api.updateAccountBankName(acctId, editingValue);
        setAccounts(accounts.map(a => a.id === acctId ? { ...a, bank_name: editingValue } : a));
      } else if (editingType === 'name') {
        if (!editingValue.trim()) {
          setError('Account name cannot be empty.');
          return;
        }
        await api.updateAccountName(acctId, editingValue);
        setAccounts(accounts.map(a => a.id === acctId ? { ...a, name: editingValue } : a));
      }
      setEditingId(null);
      setEditingType(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingType(null);
    setEditingValue('');
  };

  const toggleHidden = async (acct) => {
    try {
      const newHidden = !acct.is_hidden;
      await api.updateAccountHidden(acct.id, newHidden);
      // If we're not showing hidden, remove from list
      if (!showHidden && newHidden) {
        setAccounts(accounts.filter(a => a.id !== acct.id));
      } else {
        setAccounts(accounts.map(a => a.id === acct.id ? { ...a, is_hidden: newHidden ? 1 : 0 } : a));
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleSelect = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === accounts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(accounts.map(a => a.id)));
    }
  };

  const startBulkEdit = () => {
    if (selectedIds.size === 0) return;
    setBulkEditing(true);
    setBulkBank('');
    setBulkName('');
  };

  const saveBulkEdit = async () => {
    try {
      if (bulkBank.trim()) {
        const updates = [];
        for (const id of selectedIds) updates.push({ id, bank_name: bulkBank.trim() });
        await api.bulkUpdateBankNames(updates);
      }
      if (bulkName.trim()) {
        const updates = [];
        for (const id of selectedIds) updates.push({ id, name: bulkName.trim() });
        await api.bulkUpdateAccountNames(updates);
      }
      if (!bulkBank.trim() && !bulkName.trim()) {
        setError('Enter a value for at least one field.');
        return;
      }
      loadAccounts();
      setBulkEditing(false);
      setSelectedIds(new Set());
      setBulkMode(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelBulkEdit = () => {
    setBulkEditing(false);
    setBulkBank('');
    setBulkName('');
  };

  // --- Bulk CSV import ---

  const openImport = () => {
    setShowImport(true);
    setImportAccountId(accounts[0]?.id || '');
    setImportRows([]);
    setImportPreview([]);
    setImportInvalid([]);
    setImportFileName('');
    setImportResult(null);
    setImportError('');
  };

  const closeImport = () => {
    if (importing) return;
    setShowImport(false);
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError('');
    setImportResult(null);
    setImportInvalid([]);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        // Normalize row keys: lower-case for matching
        const rawRows = results.data.map((r) => {
          const out = {};
          for (const k of Object.keys(r)) {
            out[k.trim().toLowerCase()] = r[k];
          }
          return out;
        });

        const valid = [];
        const invalid = [];
        rawRows.forEach((row, idx) => {
          const dateRaw = row.date ?? row.posted;
          const descRaw = row.description;
          const amtRaw = row.amount;
          const errors = [];
          if (dateRaw == null || dateRaw === '') errors.push('missing date');
          if (descRaw == null || String(descRaw).trim() === '') errors.push('missing description');
          if (amtRaw == null || amtRaw === '' || isNaN(parseAmount(String(amtRaw).replace(/[$,\s]/g, '')))) errors.push(`invalid amount: ${amtRaw}`);
          if (errors.length) {
            invalid.push({ row: idx + 1, reason: errors.join(', '), date: dateRaw, desc: descRaw, amt: amtRaw });
            return;
          }
          const posted = normalizeDateClient(String(dateRaw));
          if (!posted) {
            invalid.push({ row: idx + 1, reason: `unparseable date: ${dateRaw}`, date: dateRaw, desc: descRaw, amt: amtRaw });
            return;
          }
          valid.push({
            posted,
            description: String(descRaw).trim(),
            amount: Number(String(amtRaw).replace(/[$,\s]/g, '')),
          });
        });

        setImportRows(valid);
        setImportPreview(valid.slice(0, 20));
        setImportInvalid(invalid);
      },
      error: (err) => {
        setImportError(`Failed to parse CSV: ${err.message}`);
      },
    });
    // Reset input so the same file can be re-picked
    e.target.value = '';
  };

  const submitImport = async () => {
    if (!importAccountId || importRows.length === 0) return;
    setImporting(true);
    setImportError('');
    try {
      const res = await api.importAccountTransactions(Number(importAccountId), importRows);
      setImportResult(res);
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return <div className="empty-state"><p><span className="spinner" /> Loading...</p></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Accounts</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
            Show hidden
          </label>
          {accounts.length > 0 && !bulkMode && !bulkEditing && (
            <>
              <button onClick={() => setBulkMode(true)}>Bulk Edit</button>
              <button onClick={openImport}>Import CSV</button>
            </>
          )}
          {bulkMode && !bulkEditing && (
            <>
              <button onClick={toggleSelectAll}>
                {selectedIds.size === accounts.length ? 'Deselect All' : 'Select All'}
              </button>
              <button className="primary" onClick={startBulkEdit} disabled={selectedIds.size === 0}>
                Rename Selected ({selectedIds.size})
              </button>
              <button onClick={() => { setBulkMode(false); setSelectedIds(new Set()); }}>Cancel</button>
            </>
          )}
        </div>
      </div>

      {error && <div className="error-message" onClick={() => setError('')}>{error}</div>}

      {bulkEditing && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>Bulk Edit {selectedIds.size} Account{selectedIds.size !== 1 ? 's' : ''}</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
            Leave fields empty to keep existing values. Only fields with values will be applied.
          </p>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Bank Name</label>
            <input value={bulkBank} onChange={e => setBulkBank(e.target.value)} placeholder="e.g. TD Canada Trust (leave blank to keep)" autoFocus />
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Account Name</label>
            <input value={bulkName} onChange={e => setBulkName(e.target.value)} placeholder="e.g. Primary Checking (leave blank to keep)" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={saveBulkEdit} disabled={!bulkBank.trim() && !bulkName.trim()}>Save All</button>
            <button onClick={cancelBulkEdit}>Cancel</button>
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="card empty-state">
          <p>{showHidden ? 'No hidden accounts.' : 'No accounts yet. Add a connection to get started.'}</p>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                {bulkMode && <th style={{ width: 40 }}></th>}
                <SortHeader column="bank_name">Bank Name</SortHeader>
                <SortHeader column="name">Account Name</SortHeader>
                <SortHeader column="connection_name">Connection</SortHeader>
                <SortHeader column="balance" style={{ textAlign: 'right' }}>Balance</SortHeader>
                <SortHeader column="balance_date">Balance Date</SortHeader>
                <SortHeader column="is_hidden" style={{ textAlign: 'center' }}>Hidden?</SortHeader>
              </tr>
            </thead>
            <tbody>
              {sortedAccounts.map(acct => (
                <tr key={acct.id} style={{ opacity: acct.is_hidden ? 0.6 : 1 }}>
                  {bulkMode && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(acct.id)}
                        onChange={() => toggleSelect(acct.id)}
                      />
                    </td>
                  )}
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {editingId === acct.id && editingType === 'bank' ? (
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(acct.id);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          autoFocus
                          style={{ fontSize: '0.85rem', padding: '2px 6px' }}
                        />
                        <button onClick={() => saveEdit(acct.id)} style={{ fontSize: '0.75rem', padding: '2px 6px' }}>✓</button>
                        <button onClick={cancelEdit} style={{ fontSize: '0.75rem', padding: '2px 6px' }}>✗</button>
                      </div>
                    ) : (
                      <span
                        onClick={() => !bulkMode && startEdit(acct, 'bank')}
                        style={{ cursor: bulkMode ? 'default' : 'pointer', borderBottom: bulkMode ? 'none' : '1px dashed var(--text-secondary)' }}
                        title="Click to edit bank name"
                      >
                        {acct.bank_name || acct.connection_name}
                      </span>
                    )}
                  </td>
                  <td style={{ fontWeight: 500 }}>
                    {editingId === acct.id && editingType === 'name' ? (
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(acct.id);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          autoFocus
                          style={{ fontSize: '0.85rem', padding: '2px 6px' }}
                        />
                        <button onClick={() => saveEdit(acct.id)} style={{ fontSize: '0.75rem', padding: '2px 6px' }}>✓</button>
                        <button onClick={cancelEdit} style={{ fontSize: '0.75rem', padding: '2px 6px' }}>✗</button>
                      </div>
                    ) : (
                      <span
                        onClick={() => !bulkMode && startEdit(acct, 'name')}
                        style={{ cursor: bulkMode ? 'default' : 'pointer', borderBottom: bulkMode ? 'none' : '1px dashed transparent' }}
                        title="Click to edit account name"
                      >
                        {acct.name}
                      </span>
                    )}
                  </td>
                  <td>{acct.connection_name}</td>
                  <td className={`amount ${acct.balance >= 0 ? 'positive' : 'negative'}`}>
                    ${acct.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {acct.balance_date ? new Date(acct.balance_date + 'Z').toLocaleDateString() : '-'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={!!acct.is_hidden}
                      onChange={() => toggleHidden(acct)}
                      title={acct.is_hidden ? 'Hidden - click to show' : 'Visible - click to hide'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showImport && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeImport()}>
          <div className="modal" style={{ maxWidth: 720 }}>
            <h2>Bulk Import CSV</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
              Import transactions from a CSV file. Expected columns: <strong>Date, Description, Amount</strong>{' '}
              (header row required). Dates can be <code>YYYY-MM-DD</code> or <code>MM/DD/YYYY</code>.
              Amounts can include <code>$</code> and commas.
            </p>

            {importError && <div className="error-message">{importError}</div>}

            {!importResult && (
              <>
                <div className="form-group">
                  <label htmlFor="import-account">Target account</label>
                  <select
                    id="import-account"
                    value={importAccountId}
                    onChange={e => setImportAccountId(e.target.value)}
                    disabled={importing}
                  >
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.bank_name || a.connection_name} — {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="import-file">CSV file</label>
                  <input
                    id="import-file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleImportFile}
                    disabled={importing}
                  />
                  {importFileName && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                      Loaded: {importFileName}
                    </p>
                  )}
                </div>

                {importRows.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ marginBottom: 8 }}>
                      <strong>{importRows.length}</strong> valid row{importRows.length === 1 ? '' : 's'}
                      {importInvalid.length > 0 && (
                        <> · <span style={{ color: 'var(--danger)' }}>{importInvalid.length} invalid</span></>
                      )}
                    </p>

                    {importInvalid.length > 0 && (
                      <details style={{ marginBottom: 12, fontSize: '0.8rem' }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
                          Show {importInvalid.length} invalid row{importInvalid.length === 1 ? '' : 's'}
                        </summary>
                        <ul style={{ marginTop: 6, paddingLeft: 20, color: 'var(--danger)' }}>
                          {importInvalid.slice(0, 20).map((iv, i) => (
                            <li key={i}>Row {iv.row}: {iv.reason}</li>
                          ))}
                          {importInvalid.length > 20 && <li>... and {importInvalid.length - 20} more</li>}
                        </ul>
                      </details>
                    )}

                    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                      <table style={{ width: '100%', fontSize: '0.8rem' }}>
                        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                          <tr>
                            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Date</th>
                            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Description</th>
                            <th style={{ textAlign: 'right', padding: '6px 8px' }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.map((row, i) => (
                            <tr key={i}>
                              <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{row.posted}</td>
                              <td style={{ padding: '4px 8px', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>
                                {row.description}
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {row.amount.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {importRows.length > 20 && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 6 }}>
                        Showing first 20 of {importRows.length} rows.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {importResult && (
              <div
                style={{
                  padding: 14,
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--success)',
                  background: '#f0fdf4',
                  marginBottom: 16,
                  fontSize: '0.9rem',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--success)', marginBottom: 4 }}>
                  Import complete
                </div>
                <div>
                  Imported <strong>{importResult.imported}</strong> transaction{importResult.imported === 1 ? '' : 's'}
                  {importResult.skipped > 0 && (
                    <> · <span style={{ color: 'var(--text-secondary)' }}>skipped {importResult.skipped} duplicate{importResult.skipped === 1 ? '' : 's'}</span></>
                  )}
                  {importResult.errors?.length > 0 && (
                    <> · <span style={{ color: 'var(--danger)' }}>{importResult.errors.length} row error{importResult.errors.length === 1 ? '' : 's'}</span></>
                  )}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" onClick={closeImport} disabled={importing}>
                {importResult ? 'Close' : 'Cancel'}
              </button>
              {!importResult && (
                <button
                  type="button"
                  className="primary"
                  onClick={submitImport}
                  disabled={importing || !importAccountId || importRows.length === 0}
                >
                  {importing
                    ? <><span className="spinner" /> Importing...</>
                    : `Import ${importRows.length} transaction${importRows.length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
