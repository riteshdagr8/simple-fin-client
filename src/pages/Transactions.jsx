import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';
import CategorizeBanner from '../components/CategorizeBanner.jsx';

const PAGE_SIZE = 50;

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [categories, setCategories] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [assigningCat, setAssigningCat] = useState(null); // { txnId, catId }

  const [search, setSearch] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [sortBy, setSortBy] = useState('posted');
  const [sortDir, setSortDir] = useState('desc');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkCategoryId, setBulkCategoryId] = useState('');

  // Categorize job state
  const [categorizeJob, setCategorizeJob] = useState(null);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [categorizeError, setCategorizeError] = useState('');

  // AI scope controls
  const [aiScope, setAiScope] = useState('unassigned');
  const [aiScopeStart, setAiScopeStart] = useState('');
  const [aiScopeEnd, setAiScopeEnd] = useState('');
  const [aiScopeAccounts, setAiScopeAccounts] = useState([]);

  const refreshJob = useCallback(() => {
    api.getLatestCategorizeJob().then(setCategorizeJob).catch(() => {});
  }, []);

  const refreshUncategorizedCount = useCallback(() => {
    api.getUncategorizedCount().then(d => setUncategorizedCount(d.count)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshJob();
    refreshUncategorizedCount();
  }, [refreshJob, refreshUncategorizedCount]);

  // When transactions load, also update the uncategorized count
  useEffect(() => { refreshUncategorizedCount(); }, [transactions, refreshUncategorizedCount]);

  // Refresh the job status when the page loads
  useEffect(() => {
    refreshJob();
  }, [refreshJob]);

  // When a job finishes, reload the transactions list
  useEffect(() => {
    if (categorizeJob && (categorizeJob.status === 'done' || categorizeJob.status === 'failed')) {
      loadTxns();
      refreshUncategorizedCount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorizeJob?.status]);

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir(column === 'posted' || column === 'amount' ? 'desc' : 'asc');
    }
    setOffset(0);
    setSelectedIds(new Set());
  };

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
    api.getAccounts().then(setAccounts).catch(() => {});
    api.getCategories().then(setCategories).catch(() => {});
  }, []);

  const loadTxns = (pageOffset = offset) => {
    setLoading(true);
    const params = { limit: PAGE_SIZE, offset: pageOffset, sort_by: sortBy, sort_dir: sortDir };
    if (search) params.search = search;
    if (bankName) params.bank_name = bankName;
    if (accountId) params.account_id = accountId;
    if (categoryId) params.category_id = categoryId;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;

    api.getTransactions(params)
      .then(data => {
        setTransactions(data.transactions);
        setTotal(data.total);
        setSelectedIds(new Set());
      })
      .catch(err => { if (err.message !== 'Unauthorized') setError(err.message); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTxns(); }, [search, bankName, accountId, categoryId, startDate, endDate, offset, sortBy, sortDir]);

  // Derived: unique bank names and accounts filtered by selected bank
  const uniqueBanks = [...new Set(accounts.map(a => a.bank_name).filter(Boolean))].sort();
  const filteredAccounts = bankName ? accounts.filter(a => a.bank_name === bankName) : accounts;

  const handleAI = async () => {
    setAiLoading(true);
    setCategorizeError('');
    try {
      const params = { scope: aiScope, limit: 200 };
      if (aiScope === 'date') {
        if (aiScopeStart) params.start_date = aiScopeStart;
        if (aiScopeEnd) params.end_date = aiScopeEnd;
      } else if (aiScope === 'accounts') {
        params.account_ids = aiScopeAccounts;
      } else if (aiScope === 'selected') {
        params.transaction_ids = Array.from(selectedIds);
        if (params.transaction_ids.length === 0) {
          setCategorizeError('Select at least one transaction.');
          setAiLoading(false);
          return;
        }
      }
      const res = await api.categorizeWithLLM(params);
      if (res.job_id) {
        refreshJob();
      } else {
        setAiResult(res.message || 'Nothing to categorize.');
      }
    } catch (err) {
      if (err.message && err.message.includes('already in progress')) {
        setCategorizeError('A categorize job is already running.');
        refreshJob();
      } else {
        setCategorizeError(err.message);
      }
    } finally {
      setAiLoading(false);
    }
  };

  const startAnotherJob = () => {
    // Dismiss the current "done" banner and start a new job
    if (categorizeJob) {
      api.dismissCategorizeJob(categorizeJob.id).catch(() => {});
    }
    setCategorizeJob(null);
    setTimeout(() => handleAI(), 100);
  };

  const handleAssign = async (txnId, catId) => {
    setAssigningCat({ txnId, catId });
    try {
      await api.categorizeTransaction(txnId, catId);
      loadTxns();
    } catch (err) {
      setError(err.message);
    } finally {
      setAssigningCat(null);
    }
  };

  // Bulk-select handlers
  const toggleSelect = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (transactions.every(t => selectedIds.has(t.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map(t => t.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkAssign = async (clearInstead = false) => {
    if (selectedIds.size === 0) return;
    if (!clearInstead && !bulkCategoryId) {
      setError('Pick a category first.');
      return;
    }
    setBulkAssigning(true);
    setError('');
    try {
      const ids = Array.from(selectedIds);
      const catId = clearInstead ? null : Number(bulkCategoryId);
      const res = await api.bulkCategorizeTransactions(ids, catId);
      setBulkCategoryId('');
      setSelectedIds(new Set());
      loadTxns();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkAssigning(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const allSelected = transactions.length > 0 && transactions.every(t => selectedIds.has(t.id));

  return (
    <div>
      <div className="page-header">
        <h1>Transactions</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {categorizeError && (
            <span style={{ fontSize: '0.85rem', color: 'var(--danger)' }}>{categorizeError}</span>
          )}
          <select value={aiScope} onChange={e => setAiScope(e.target.value)} style={{ width: 'auto', minWidth: 160 }} title="Which transactions to include in the AI categorize job">
            <option value="unassigned">Unassigned only</option>
            <option value="all">All transactions</option>
            <option value="date">By date range</option>
            <option value="accounts">By accounts</option>
            <option value="selected">Selected only ({selectedIds.size})</option>
          </select>
          {aiScope === 'date' && (
            <>
              <input type="date" value={aiScopeStart} onChange={e => setAiScopeStart(e.target.value)} style={{ width: 'auto' }} />
              <input type="date" value={aiScopeEnd} onChange={e => setAiScopeEnd(e.target.value)} style={{ width: 'auto' }} />
            </>
          )}
          {aiScope === 'accounts' && (
            <select
              multiple
              value={aiScopeAccounts}
              onChange={e => setAiScopeAccounts(Array.from(e.target.selectedOptions).map(o => Number(o.value)))}
              style={{ width: 'auto', minWidth: 200, height: 36 }}
              title="Hold Ctrl/Cmd to select multiple"
            >
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button className="primary" onClick={handleAI} disabled={aiLoading}>
            {aiLoading
              ? <><span className="spinner" /> Starting...</>
              : uncategorizedCount > 0 && aiScope === 'unassigned'
                ? `🤖 Categorize ${uncategorizedCount} with AI`
                : '🤖 Run AI Categorize'}
          </button>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{total.toLocaleString()} total</span>
        </div>
      </div>

      <CategorizeBanner
        job={categorizeJob}
        onDismiss={() => setCategorizeJob(null)}
        onStartAnother={startAnotherJob}
        onRefresh={() => {
          refreshJob();
          if (categorizeJob && (categorizeJob.status === 'done' || categorizeJob.status === 'failed')) {
            refreshUncategorizedCount();
            loadTxns();
          }
        }}
      />

      <div className="card" style={{ padding: 12 }}>
        <div className="filters">
          <div className="form-group">
            <label>Search</label>
            <input value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} placeholder="Description or category..." />
          </div>
          {uniqueBanks.length > 1 && (
            <div className="form-group">
              <label>Bank</label>
              <select value={bankName} onChange={e => { setBankName(e.target.value); setAccountId(''); setOffset(0); }}>
                <option value="">All Banks</option>
                {uniqueBanks.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Account</label>
            <select value={accountId} onChange={e => { setAccountId(e.target.value); setOffset(0); }}>
              <option value="">All Accounts</option>
              {filteredAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Category</label>
            <select value={categoryId} onChange={e => { setCategoryId(e.target.value); setOffset(0); }}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Start Date</label>
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setOffset(0); }} />
          </div>
          <div className="form-group">
            <label>End Date</label>
            <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setOffset(0); }} />
          </div>
          <button onClick={() => { setSearch(''); setBankName(''); setAccountId(''); setCategoryId(''); setStartDate(''); setEndDate(''); setOffset(0); }}>
            Clear
          </button>
        </div>
      </div>

      {error && <div className="error-message" onClick={() => setError('')}>{error}</div>}

      {selectedIds.size > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 16, background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
              {selectedIds.size} selected
            </span>
            <select value={bulkCategoryId} onChange={e => setBulkCategoryId(e.target.value)} style={{ width: 'auto', minWidth: 180 }}>
              <option value="">Choose category…</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
            <button className="primary" onClick={() => handleBulkAssign(false)} disabled={!bulkCategoryId || bulkAssigning}>
              {bulkAssigning ? <><span className="spinner" /> Applying...</> : 'Assign Category'}
            </button>
            <button onClick={() => handleBulkAssign(true)} disabled={bulkAssigning} title="Remove the current category from selected transactions">
              Clear Category
            </button>
            <button onClick={clearSelection}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="empty-state"><p><span className="spinner" /> Loading...</p></div>
        ) : transactions.length === 0 ? (
          <div className="empty-state"><p>No transactions found.</p></div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      title="Select all on this page"
                    />
                  </th>
                  <SortHeader column="posted">Date</SortHeader>
                  <SortHeader column="bank_name">Bank</SortHeader>
                  <SortHeader column="account_name">Account</SortHeader>
                  <SortHeader column="description">Description</SortHeader>
                  <SortHeader column="category_name">Category</SortHeader>
                  <SortHeader column="amount" style={{ textAlign: 'right' }}>Amount</SortHeader>
                </tr>
              </thead>
              <tbody>
                {transactions.map(txn => {
                  const isSelected = selectedIds.has(txn.id);
                  return (
                    <tr key={txn.id} style={{ background: isSelected ? 'var(--accent-soft)' : undefined }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(txn.id)}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                        {new Date(txn.posted + 'Z').toLocaleDateString()}
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {txn.bank_name || txn.connection_name}
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {txn.account_name}
                      </td>
                      <td style={{ fontSize: '0.85rem', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={txn.description}>
                        {txn.description}
                      </td>
                      <td>
                        <CategorySelector
                          txnId={txn.id}
                          categoryId={txn.category_id}
                          categoryName={txn.category_name}
                          categoryIcon={txn.category_icon}
                          categoryColor={txn.category_color}
                          categories={categories}
                          onAssign={handleAssign}
                          assigning={assigningCat?.txnId === txn.id}
                        />
                      </td>
                      <td className={`amount ${txn.amount >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: '0.85rem' }}>
                        ${Math.abs(txn.amount).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="pagination">
                <button disabled={offset === 0} onClick={() => setOffset(offset - PAGE_SIZE)}>Previous</button>
                <span>Page {currentPage} of {totalPages}</span>
                <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CategorySelector({ txnId, categoryId, categoryName, categoryIcon, categoryColor, categories, onAssign, assigning }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const trigger = categoryId ? (
    <span
      onClick={() => setOpen(!open)}
      style={{
        fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
        background: (categoryColor || '#9ca3af') + '22',
        color: categoryColor || 'var(--text)',
        fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4,
      }}
      title="Click to change category"
    >
      {categoryIcon} {categoryName}
      {assigning ? ' ⏳' : ''}
    </span>
  ) : (
    <button
      onClick={() => setOpen(!open)}
      style={{ fontSize: '0.75rem', padding: '2px 8px', background: 'none', border: '1px dashed var(--border)', borderRadius: 10, cursor: 'pointer', color: 'var(--text-secondary)' }}
    >
      + Assign{assigning ? ' ⏳' : ''}
    </button>
  );

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {trigger}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 20, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          minWidth: 160, marginTop: 4, maxHeight: 240, overflowY: 'auto',
        }}>
          {categories.map(cat => (
            <button key={cat.id}
              onClick={() => { onAssign(txnId, cat.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                background: cat.id === categoryId ? 'var(--accent-soft)' : 'none',
                border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', fontSize: '0.85rem',
              }}>
              <span>{cat.icon}</span>
              <span style={{ color: cat.color }}>{cat.name}</span>
              {cat.id === categoryId && <span style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
