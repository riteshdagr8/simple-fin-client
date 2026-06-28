import { useEffect, useRef } from 'react';

export default function ConfirmDialog({ isOpen, title, message, onConfirm, onCancel, confirmText = 'Delete', cancelText = 'Cancel', danger = true }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      dialogRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (isOpen && e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={dialogRef} className="modal" tabIndex={-1} style={{ maxWidth: 400 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: '1.1rem' }}>{title}</h2>
        <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {message}
        </p>
        <div className="modal-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}>{cancelText}</button>
          <button onClick={onConfirm} style={{ background: danger ? 'var(--danger)' : 'var(--accent)', color: 'white', border: 'none' }}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
