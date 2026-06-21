function formatTime(ts) {
  if (!ts) return null;
  // New format: ISO with Z (e.g. 2026-06-20T18:41:15.000Z)
  // Old format: SQLite naive datetime (e.g. 2026-06-20 18:41:15) — interpret as UTC
  let iso = ts;
  if (typeof ts === 'string' && !ts.includes('T')) {
    iso = ts.replace(' ', 'T') + 'Z';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export default function SyncStatus({ status, lastSyncAt, lastError }) {
  const label = {
    healthy: 'OK',
    error: 'Error',
    pending: 'Pending',
    in_progress: 'Syncing',
  }[status] || status;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
      <span className={`status ${status}`}>
        {status === 'in_progress' && <span className="spinner" />}
        {label}
      </span>
      {lastSyncAt && (
        <span style={{ color: 'var(--text-secondary)' }}>
          Last sync: {formatTime(lastSyncAt)}
        </span>
      )}
      {lastError && status === 'error' && (
        <span style={{ color: 'var(--danger)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lastError}
        </span>
      )}
    </div>
  );
}
