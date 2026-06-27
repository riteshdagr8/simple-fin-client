import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

export default function Receipts() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);  // receipt id for detail view
  const [candidates, setCandidates] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    loadReceipts();
  }, []);

  const loadReceipts = () => {
    setLoading(true);
    api.getReceipts()
      .then(setReceipts)
      .catch(err => { if (err.message !== 'Unauthorized') alert(err.message); })
      .finally(() => setLoading(false));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file (jpg, png, etc.)');
      return;
    }
    setUploadError('');
    uploadFile(file);
    e.target.value = '';
  };

  const uploadFile = async (file) => {
    setUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]); // base64 only
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      await api.uploadReceipt({
        filename: file.name,
        originalName: file.name,
        data,
        amount: amount ? parseFloat(amount) : null,
        description: description || null,
      });

      setAmount('');
      setDescription('');
      loadReceipts();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSelectReceipt = async (id) => {
    setSelected(id);
    try {
      const data = await api.getReceipt(id);
      setCandidates(data.candidates || []);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleMatch = async (receiptId, txnId) => {
    try {
      await api.matchReceipt(receiptId, txnId);
      await loadReceipts();
      const updated = receipts.map(r =>
        r.id === receiptId
          ? { ...r, matched_transaction_id: txnId, txn_amount: candidates.find(c => c.id === txnId)?.amount }
          : r
      );
      setSelected(receiptId);
      const fresh = await api.getReceipt(receiptId);
      setCandidates(fresh.candidates || []);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUnmatch = async (receiptId) => {
    try {
      await api.unmatchReceipt(receiptId);
      await loadReceipts();
      const fresh = await api.getReceipt(receiptId);
      setSelected(receiptId);
      setCandidates(fresh.candidates || []);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this receipt?')) return;
    try {
      await api.deleteReceipt(id);
      if (selected === id) { setSelected(null); setCandidates([]); }
      loadReceipts();
    } catch (err) {
      alert(err.message);
    }
  };

  const matched = receipts.filter(r => r.matched_transaction_id);
  const unmatched = receipts.filter(r => !r.matched_transaction_id);

  if (loading) {
    return <div className="empty-state"><p><span className="spinner" /> Loading...</p></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Receipts</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" placeholder="Amount (optional)" value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ width: 120 }} />
          <input type="text" placeholder="Description (optional)" value={description}
            onChange={e => setDescription(e.target.value)}
            style={{ width: 200 }} />
          <label className="btn" style={{ cursor: 'pointer', position: 'relative' }}>
            📎 Upload Receipt
            <input type="file" ref={fileRef} accept="image/*"
              onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {uploading && (
        <div style={{ marginBottom: 12, padding: 10, background: 'var(--accent-soft)', border: '1px solid var(--accent)',
          borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="spinner" style={{ width: 16, height: 16 }} />
          Uploading...
        </div>
      )}
      {uploadError && <div className="error-message" onClick={() => setUploadError('')}>{uploadError}</div>}

      {receipts.length === 0 ? (
        <div className="card empty-state">
          <p>No receipts uploaded yet.</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Click "Upload Receipt" above, then match each receipt to a transaction by amount.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 400px' : '1fr', gap: 16 }}>
          {/* Receipt List */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {matched.length > 0 && (
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: '#f0fdf4', fontSize: '0.8rem', color: '#16a34a', fontWeight: 600 }}>
                {matched.length} matched
              </div>
            )}
            {unmatched.length > 0 && (
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--accent-soft)', fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>
                {unmatched.length} unmatched — click to match
              </div>
            )}
            {receipts.map(r => (
              <div key={r.id} onClick={() => handleSelectReceipt(r.id)}
                style={{
                  padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                  background: selected === r.id ? 'var(--accent-soft)' : 'transparent',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                <img src={api.getReceiptImage(r.id)} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.original_name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {r.amount != null ? `$${r.amount.toFixed(2)}` : 'No amount'}
                    {r.matched_transaction_id && (
                      <span style={{ color: '#16a34a', marginLeft: 8 }}>✓ Matched</span>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {new Date(r.uploaded_at + 'Z').toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>

          {/* Receipt Detail + Match Panel */}
          {selected && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, position: 'sticky', top: 16, alignSelf: 'start' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Receipt Detail</h3>
                <button onClick={() => { setSelected(null); setCandidates([]); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
              </div>

              <img src={api.getReceiptImage(selected)} alt="Receipt"
                style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 'var(--radius)', background: '#f5f5f5' }} />

              <div>
                <button onClick={() => handleDelete(selected)} style={{ background: 'var(--danger)', color: 'white', border: 'none', borderRadius: 'var(--radius)', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem' }}>
                  Delete Receipt
                </button>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Match to Transaction</h4>
                {candidates.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    No matching transactions found. Enter an amount when uploading to find matches.
                  </p>
                ) : (
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                    {candidates.map(c => (
                      <div key={c.id}
                        onClick={() => handleMatch(selected, c.id)}
                        style={{
                          padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          fontSize: '0.85rem',
                        }}>
                        <div>
                          <div style={{ fontWeight: 500 }}>{c.description}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {c.account_name} · {new Date(c.posted + 'Z').toLocaleDateString()}
                          </div>
                        </div>
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                          ${c.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
