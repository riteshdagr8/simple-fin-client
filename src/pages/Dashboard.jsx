import { useState, useEffect } from 'react';
import { api } from '../api.js';
import PieChart from '../components/PieChart.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('last30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // pending* is what the user has selected; only commit on Apply
  const [pendingPeriod, setPendingPeriod] = useState('last30');
  const [pendingStart, setPendingStart] = useState('');
  const [pendingEnd, setPendingEnd] = useState('');
  const [uncategorizedCount, setUncategorizedCount] = useState(0);

  useEffect(() => {
    api.getUncategorizedCount().then(d => setUncategorizedCount(d.count)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = { period };
    if (period === 'custom') {
      params.start_date = customStart;
      params.end_date = customEnd;
    }
    api.getDashboard(params)
      .then(setData)
      .catch(err => { if (err.message !== 'Unauthorized') setError(err.message); })
      .finally(() => setLoading(false));
  }, [period, customStart, customEnd]);

  const applyFilters = () => {
    setPeriod(pendingPeriod);
    setCustomStart(pendingStart);
    setCustomEnd(pendingEnd);
  };

  if (loading && !data) return <div className="empty-state"><p><span className="spinner" /> Loading...</p></div>;
  if (error) return <div className="empty-state"><p className="error-message">{error}</p></div>;
  if (!data) return null;

  const { totalBalance, accountCount, recentTransactions, categorySpending } = data;
  const visibleSpending = (categorySpending || []).filter(c => c.total !== 0);
  const totalSpend = visibleSpending.reduce((sum, c) => sum + Math.abs(c.total), 0);

  return (
    <div>
      <h1>Dashboard</h1>

      <div className="summary">
        <div className="card">
          <div className="value" style={{ color: totalBalance < 0 ? 'var(--danger)' : 'var(--success)' }}>
            ${Math.abs(totalBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="label">Net Balance ({accountCount} accounts)</div>
        </div>
        <div className="card">
          <div className="value" style={{ color: 'var(--danger)' }}>
            ${totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="label">Spent in Period</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Spending by Category</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={pendingPeriod} onChange={e => setPendingPeriod(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
              <option value="last30">Last 30 days</option>
              <option value="month">This month</option>
              <option value="year">This year</option>
              <option value="all">All time</option>
              <option value="custom">Custom range</option>
            </select>
            <button className="primary" onClick={applyFilters} disabled={loading || (pendingPeriod === 'custom' && (!pendingStart || !pendingEnd))}>
              {loading ? <><span className="spinner" /> Loading...</> : 'Apply'}
            </button>
          </div>
        </div>

        {pendingPeriod === 'custom' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" value={pendingStart} onChange={e => setPendingStart(e.target.value)} style={{ width: 'auto' }} />
            <span style={{ color: 'var(--text-secondary)' }}>to</span>
            <input type="date" value={pendingEnd} onChange={e => setPendingEnd(e.target.value)} style={{ width: 'auto' }} />
          </div>
        )}

        {uncategorizedCount > 0 && (
          <div
            onClick={() => { window.location.hash = '#/transactions'; }}
            style={{
              marginBottom: 12, padding: '10px 14px', borderRadius: 'var(--radius)',
              background: 'var(--accent-soft)', border: '1px solid var(--accent)',
              display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 500,
            }}
            title="Click to go to Transactions and categorize"
          >
            <span>📌</span>
            <span>{uncategorizedCount} transaction{uncategorizedCount !== 1 ? 's' : ''} uncategorized</span>
            <span style={{ opacity: 0.7 }}>→</span>
          </div>
        )}

        {visibleSpending.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No categorized spending in this period.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) 1fr', gap: 24, alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <PieChart data={visibleSpending} size={200} />
              <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {visibleSpending.length} {visibleSpending.length === 1 ? 'category' : 'categories'}
              </div>
            </div>
            <div>
              {visibleSpending.slice(0, 8).map(cat => {
                const pct = totalSpend > 0 ? (Math.abs(cat.total) / totalSpend) * 100 : 0;
                return (
                  <div key={cat.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', marginBottom: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: cat.color || 'var(--accent)', flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{cat.icon} {cat.name}</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', minWidth: 40, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                      <span className="amount negative" style={{ fontWeight: 500, minWidth: 80, textAlign: 'right' }}>
                        ${Math.abs(cat.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: cat.color || 'var(--accent)', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="page-header">
        <h2>Transactions</h2>
        <a href="#/transactions" className="btn">View All</a>
      </div>
      <div className="card">
        {recentTransactions.length === 0 ? (
          <div className="empty-state"><p>No transactions yet.</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map(txn => (
                <tr key={txn.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                    {new Date(txn.posted + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>{txn.description}</td>
                  <td>
                    {txn.category_name ? (
                      <span style={{
                        fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10,
                        background: txn.category_color + '22', color: txn.category_color,
                        fontWeight: 500,
                      }}>
                        {txn.category_icon} {txn.category_name}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>—</span>
                    )}
                  </td>
                  <td className={`amount ${txn.amount >= 0 ? 'positive' : 'negative'}`} style={{ fontSize: '0.85rem' }}>
                    ${Math.abs(txn.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
