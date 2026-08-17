import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const pct = (n) => `${Math.round(n * 100)}%`;
const fmtDate = (posted) => {
  if (!posted) return '';
  const d = new Date(String(posted).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return posted;
  return d.toLocaleDateString();
};
const fmtAmount = (n) => (n < 0 ? '-' : '+') + '$' + Math.abs(n).toFixed(2);
const confidenceLabel = (s) => (s >= 0.85 ? 'High' : s >= 0.78 ? 'Medium' : 'Low');

export default function Transfers() {
  const [candidates, setCandidates] = useState([]);
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [pendingTxn, setPendingTxn] = useState(null); // candidate being reconciled
  const [unpairTxn, setUnpairTxn] = useState(null); // pair being unpaired
  const [pairing, setPairing] = useState({}); // txnId -> true while request in flight

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pairRes, candRes] = await Promise.all([
        api.getTransferPairs().catch(() => ({ pairs: [] })),
        api.getTransferCandidates().catch(() => ({ candidates: [] })),
      ]);
      setPairs(pairRes.pairs || []);
      setCandidates(candRes.candidates || []);
    } catch (err) {
      if (err.message !== 'Unauthorized') setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleScan = async () => {
    setScanning(true);
    setError('');
    setInfo('');
    try {
      const res = await api.scanTransfers();
      setPairs(await api.getTransferPairs().then(r => r.pairs).catch(() => []));
      setCandidates(res.candidates || []);
      if (res.auto_paired > 0) {
        setInfo(`Auto-reconciled ${res.auto_paired} transfer${res.auto_paired !== 1 ? 's' : ''}. Review them below and unpair if wrong.`);
      } else if (!res.candidates?.length) {
        setInfo('No new transfers found.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const confirmReconcile = async () => {
    if (!pendingTxn) return;
    setPairing(prev => ({ ...prev, [pendingTxn.debit.id]: true }));
    setError('');
    try {
      await api.createTransferPair(pendingTxn.debit.id, pendingTxn.credit.id, 'manual', '');
      setPendingTxn(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPairing(prev => ({ ...prev, [pendingTxn.debit.id]: false }));
    }
  };

  const confirmUnpair = async () => {
    if (!unpairTxn) return;
    setPairing(prev => ({ ...prev, ['unpair-' + unpairTxn.id]: true }));
    setError('');
    try {
      await api.deleteTransferPair(unpairTxn.id);
      setUnpairTxn(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPairing(prev => ({ ...prev, ['unpair-' + unpairTxn.id]: false }));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Transfer Reconciliation</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 4 }}>
            Transfers between your own accounts cancel out and are removed from spending totals.
          </p>
        </div>
        <button className="primary" onClick={handleScan} disabled={scanning || loading}>
          {scanning ? <><span className="spinner" /> Scanning...</> : '🔍 Scan for transfers'}
        </button>
      </div>

      {error && <div className="error-message" onClick={() => setError('')}>{error}</div>}
      {info && <div style={{ background: 'var(--info-bg)', color: 'var(--accent)', padding: '10px 14px', borderRadius: 'var(--radius)', marginBottom: 16, fontSize: '0.85rem' }}>{info}</div>}

      <div className="card">
        <h2>Suggested matches</h2>
        {candidates.length === 0 ? (
          <div className="empty-state"><p>No likely transfer pairs found. Run a scan to look for matches.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Amount</th>
                  <th>Debit date</th>
                  <th>Credit date</th>
                  <th>Confidence</th>
                  <th>Description</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => (
                  <tr key={`${c.debit.id}-${c.credit.id}`}>
                    <td>{c.debit.account_name}</td>
                    <td>{c.credit.account_name}</td>
                    <td>{fmtAmount(c.debit.amount)}</td>
                    <td>{fmtDate(c.debit.posted)}</td>
                    <td>{fmtDate(c.credit.posted)}</td>
                    <td><span className="status healthy">{pct(c.score)} · {confidenceLabel(c.score)}</span></td>
                    <td style={{ maxWidth: 220 }}>
                      <div style={{ fontSize: '0.8rem' }}>{c.debit.description}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{c.credit.description}</div>
                    </td>
                    <td>
                      <button className="primary" disabled={pairing[c.debit.id]}
                              onClick={() => setPendingTxn(c)}>
                        Reconcile
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Reconciled transfers</h2>
        {pairs.length === 0 ? (
          <div className="empty-state"><p>No reconciled transfers yet. Reconciled transfers are excluded from spending.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Amount</th>
                  <th>Debit date</th>
                  <th>Credit date</th>
                  <th>Matched</th>
                  <th>Matched at</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pairs.map(p => (
                  <tr key={p.id}>
                    <td>{p.debit?.account_name}</td>
                    <td>{p.credit?.account_name}</td>
                    <td>{fmtAmount(p.debit?.amount)}</td>
                    <td>{fmtDate(p.debit?.posted)}</td>
                    <td>{fmtDate(p.credit?.posted)}</td>
                    <td>{p.matched_by === 'auto' ? 'Auto' : 'Manual'}</td>
                    <td>{fmtDate(p.matched_at)}</td>
                    <td>
                      <button disabled={pairing['unpair-' + p.id]}
                              onClick={() => setUnpairTxn(p)}>
                        Unpair
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!pendingTxn}
        title="Reconcile this transfer?"
        message={`${pendingTxn ? fmtAmount(pendingTxn.debit.amount) : ''} from ${pendingTxn?.debit?.account_name} to ${pendingTxn?.credit?.account_name}. It will be removed from spending totals.`}
        onConfirm={confirmReconcile}
        onCancel={() => setPendingTxn(null)}
        confirmText="Reconcile"
        danger={false}
      />
      <ConfirmDialog
        isOpen={!!unpairTxn}
        title="Unpair this transfer?"
        message="Both transactions will count toward spending totals again."
        onConfirm={confirmUnpair}
        onCancel={() => setUnpairTxn(null)}
        confirmText="Unpair"
      />
    </div>
  );
}
