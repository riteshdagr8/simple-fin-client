import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Shows the current state of the categorize job:
// - running: animated progress with X / Y count
// - done: success message with count and "more remaining" hint
// - failed: error message
// - dismissed: returns null
export default function CategorizeBanner({ job, onDismiss, onStartAnother, onRefresh }) {
  const [now, setNow] = useState(Date.now());

  // While running, poll every 2s for fresh status
  useEffect(() => {
    if (!job) return;
    if (job.status === 'pending' || job.status === 'running') {
      const interval = setInterval(() => {
        onRefresh && onRefresh();
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [job?.status, onRefresh]);

  // Update "X seconds ago" timer
  useEffect(() => {
    if (!job) return;
    if (job.status === 'done' || job.status === 'failed') {
      const interval = setInterval(() => setNow(Date.now()), 5000);
      return () => clearInterval(interval);
    }
  }, [job?.status]);

  if (!job) return null;

  // Hide if user dismissed the done banner
  if (job.status === 'done' && job.dismissed_at) return null;
  if (job.status === 'failed' && job.dismissed_at) return null;

  const handleDismiss = () => {
    api.dismissCategorizeJob(job.id).catch(() => {});
    onDismiss && onDismiss();
  };

  const timeAgo = (iso) => {
    if (!iso) return '';
    const seconds = Math.floor((now - new Date(iso + 'Z').getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(iso + 'Z').toLocaleDateString();
  };

  // --- Running state ---
  if (job.status === 'pending' || job.status === 'running') {
    const pct = job.items_total > 0
      ? Math.round((job.items_processed / job.items_total) * 100)
      : 0;
    return (
      <div
        className="card"
        style={{
          padding: 14, marginBottom: 16,
          background: 'var(--accent-soft)',
          borderColor: 'var(--accent)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <span className="spinner" style={{ width: 18, height: 18 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>
            Categorizing in progress…
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', transition: 'width 0.3s' }} />
            </div>
            <span style={{ whiteSpace: 'nowrap' }}>
              {job.items_processed} / {job.items_total}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // --- Done state ---
  if (job.status === 'done') {
    return (
      <div
        className="card"
        style={{
          padding: 14, marginBottom: 16,
          background: '#f0fdf4',
          borderColor: 'var(--success)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '1.2rem' }}>✓</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600, color: 'var(--success)', marginBottom: 2 }}>
            {job.items_processed} transaction{job.items_processed !== 1 ? 's' : ''} categorized
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {job.items_total - job.items_processed > 0
              ? `${job.items_total - job.items_processed} uncategorized`
              : 'All uncategorized transactions are done'}
            {' · '}
            {timeAgo(job.completed_at)}
          </div>
        </div>
        {job.items_total - job.items_processed > 0 && (
          <button className="primary" onClick={onStartAnother}>
            Categorize {job.items_total - job.items_processed} more
          </button>
        )}
        <button onClick={handleDismiss} title="Dismiss">✕</button>
      </div>
    );
  }

  // --- Failed state ---
  if (job.status === 'failed') {
    return (
      <div
        className="card"
        style={{
          padding: 14, marginBottom: 16,
          background: '#fef2f2',
          borderColor: 'var(--danger)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '1.2rem' }}>✗</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600, color: 'var(--danger)', marginBottom: 2 }}>
            Categorization failed
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {job.error_message || 'Unknown error'}
          </div>
        </div>
        <button onClick={onStartAnother}>Retry</button>
        <button onClick={handleDismiss} title="Dismiss">✕</button>
      </div>
    );
  }

  return null;
}
