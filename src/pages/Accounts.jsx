import { useState, useEffect } from 'react';
import { api } from '../api.js';

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
            <button onClick={() => setBulkMode(true)}>Bulk Edit</button>
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
    </div>
  );
}
