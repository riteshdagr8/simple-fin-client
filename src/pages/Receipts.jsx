import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

export default function Receipts() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [deleteDialog, setDeleteDialog] = useState({ open: false, receiptId: null });
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
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setUploadError('Please select an image or PDF file');
      return;
    }
    setUploadError('');
    uploadFile(file);
    e.target.value = '';
  };

  const uploadFile = async (file) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('receipt', file);
      await api.uploadReceipt(formData);
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
      const fresh = await api.getReceipt(receiptId);
      setSelected(receiptId);
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

  const handleDelete = (id) => {
    setDeleteDialog({ open: true, receiptId: id });
  };

  const confirmDelete = async () => {
    const id = deleteDialog.receiptId;
    setDeleteDialog({ open: false, receiptId: null });
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

  const isPdf = (r) => r.file_type === 'pdf';

  const formatScore = (score) => {
    if (score == null) return '';
    const pct = Math.round(score * 100);
    if (pct >= 70) return { label: `${pct}%`, color: '#16a34a' };
    if (pct >= 40) return { label: `${pct}%`, color: '#ca8a04' };
    return { label: `${pct}%`, color: '#dc2626' };
  };

  if (loading) {
    return <div className="empty-state"><p><span className="spinner" /> Loading...</p></div>;
  }

  const selectedReceipt = selected ? receipts.find(r => r.id === selected) : null;

  return (
    <div>
      <div className="page-header">
        <h1>Receipts</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="btn" style={{ cursor: 'pointer', position: 'relative' }}>
            📎 Upload Receipt
            <input type="file" ref={fileRef} accept="image/*,application/pdf"
              onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {uploading && (
        <div style={{ marginBottom: 12, padding: 10, background: 'var(--accent-soft)', border: '1px solid var(--accent)',
          borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="spinner" style={{ width: 16, height: 16 }} />
          Uploading and processing...
        </div>
      )}
      {uploadError && <div className="error-message" onClick={() => setUploadError('')}>{uploadError}</div>}

      {receipts.length === 0 ? (
        <div className="card empty-state">
          <p>No receipts uploaded yet.</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Upload an image or PDF receipt, or drop a file into your receipts folder for automatic processing.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', gap: 16 }}>
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
            {receipts.map(r => {
              const score = formatScore(r.match_score);
              return (
                <div key={r.id} onClick={() => handleSelectReceipt(r.id)}
                  style={{
                    padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                    background: selected === r.id ? 'var(--accent-soft)' : 'transparent',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                  {isPdf(r) ? (
                    <div style={{ width: 40, height: 40, borderRadius: 4, background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: '#dc2626' }}>
                      PDF
                    </div>
                  ) : (
                    <img src={api.getReceiptFile(r.id)} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.original_name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {r.extracted_total != null && <span>${r.extracted_total.toFixed(2)}</span>}
                      {r.extracted_vendor && <span>· {r.extracted_vendor}</span>}
                      {r.extracted_date && <span>· {r.extracted_date}</span>}
                      {r.matched_transaction_id && <span style={{ color: '#16a34a' }}>✓ Matched</span>}
                      {score && <span style={{ color: score.color }}>{score.label}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {new Date(r.uploaded_at + 'Z').toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Receipt Detail + Match Panel */}
          {selected && selectedReceipt && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, position: 'sticky', top: 16, alignSelf: 'start' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Receipt Detail</h3>
                <button onClick={() => { setSelected(null); setCandidates([]); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
              </div>

              {isPdf(selectedReceipt) ? (
                <div style={{ padding: 24, background: '#f5f5f5', borderRadius: 'var(--radius)', textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>PDF Receipt</div>
                  <a href={api.getReceiptFile(selected)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem' }}>View PDF</a>
                </div>
              ) : (
                <img src={api.getReceiptFile(selected)} alt="Receipt"
                  style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 'var(--radius)', background: '#f5f5f5' }} />
              )}

              {/* Extracted data */}
              {(selectedReceipt.extracted_total != null || selectedReceipt.extracted_vendor || selectedReceipt.extracted_date) && (
                <div style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 'var(--radius)', fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Extracted Data</div>
                  {selectedReceipt.extracted_total != null && (
                    <div>Total: <strong>${selectedReceipt.extracted_total.toFixed(2)}</strong></div>
                  )}
                  {selectedReceipt.extracted_vendor && (
                    <div>Vendor: <strong>{selectedReceipt.extracted_vendor}</strong></div>
                  )}
                  {selectedReceipt.extracted_date && (
                    <div>Date: <strong>{selectedReceipt.extracted_date}</strong></div>
                  )}
                  {selectedReceipt.match_score != null && (
                    <div>Match confidence: <strong style={{ color: formatScore(selectedReceipt.match_score).color }}>{Math.round(selectedReceipt.match_score * 100)}%</strong></div>
                  )}
                  {selectedReceipt.ocr_status === 'pending' && (
                    <div style={{ color: 'var(--accent)' }}>Processing...</div>
                  )}
                  {selectedReceipt.ocr_status === 'failed' && (
                    <div style={{ color: 'var(--danger)' }}>OCR failed</div>
                  )}
                </div>
              )}

              <div>
                <button onClick={() => handleDelete(selected)} style={{ background: 'var(--danger)', color: 'white', border: 'none', borderRadius: 'var(--radius)', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem' }}>
                  Delete Receipt
                </button>
                {selectedReceipt.matched_transaction_id && (
                  <button onClick={() => handleUnmatch(selected)} style={{ marginLeft: 8, background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    Unmatch
                  </button>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>Match to Transaction</h4>
                {candidates.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    No matching transactions found.
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
                          background: c.id === selectedReceipt.matched_transaction_id ? 'var(--accent-soft)' : 'transparent',
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

      <ConfirmDialog
        isOpen={deleteDialog.open}
        title="Delete Receipt"
        message="Are you sure you want to delete this receipt? This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteDialog({ open: false, receiptId: null })}
        confirmText="Delete"
        cancelText="Cancel"
        danger
      />
    </div>
  );
}
