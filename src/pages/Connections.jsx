import { useState, useEffect } from 'react';
import { api } from '../api.js';
import SyncStatus from '../components/SyncStatus.jsx';

export default function Connections() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [deleting, setDeleting] = useState(null);

  const fetchConnections = () => {
    api.getConnections()
      .then(setConnections)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchConnections(); }, []);
  useEffect(() => {
    // Poll while any connection is syncing
    if (connections.some(c => c.last_sync_at === null && c.last_error === null)) {
      const interval = setInterval(fetchConnections, 3000);
      return () => clearInterval(interval);
    }
  }, [connections]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim() || !setupToken.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      await api.createConnection(name.trim(), setupToken.trim());
      setName('');
      setSetupToken('');
      setShowAdd(false);
      fetchConnections();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this connection and all its data?')) return;
    setDeleting(id);
    try {
      await api.deleteConnection(id);
      fetchConnections();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleSync = async (id) => {
    try {
      await api.syncConnection(id);
      fetchConnections();
    } catch (err) {
      setError(err.message);
    }
  };

  const isAtLimit = (conn) => conn.syncs_today >= conn.sync_limit;

  if (loading) {
    return <div className="empty-state"><p><span className="spinner" /> Loading...</p></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Connections</h1>
        <button className="primary" onClick={() => setShowAdd(true)}>Add Connection</button>
      </div>

      {error && <div className="error-message" onClick={() => setError('')}>{error}</div>}

      {connections.length === 0 ? (
        <div className="card empty-state">
          <p>No connections yet.</p>
          <p>Go to <a href="https://beta-bridge.simplefin.org/simplefin/create" target="_blank" rel="noopener">SimpleFIN Bridge</a> to create a Setup Token, then add your first connection.</p>
          <button className="primary" onClick={() => setShowAdd(true)}>Add Connection</button>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Accounts</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map(conn => {
                const atLimit = isAtLimit(conn);
                return (
                <tr key={conn.id}>
                  <td style={{ fontWeight: 500 }}>{conn.name}</td>
                  <td>{conn.account_count}</td>
                  <td>
                    <SyncStatus
                      status={conn.last_error ? 'error' : conn.last_sync_at ? 'healthy' : 'pending'}
                      lastSyncAt={conn.last_sync_at}
                      lastError={conn.last_error}
                    />
                    <div style={{ fontSize: '0.75rem', color: atLimit ? 'var(--danger)' : 'var(--text-secondary)', marginTop: 2 }}>
                      Syncs today: {conn.syncs_today}/{conn.sync_limit}
                      {atLimit && ' — limit reached'}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => handleSync(conn.id)}
                        disabled={deleting === conn.id || atLimit}
                        title={atLimit ? 'Daily sync limit reached (24/24)' : 'Sync now'}
                      >
                        Sync
                      </button>
                      <button className="danger" onClick={() => handleDelete(conn.id)} disabled={deleting === conn.id}>
                        {deleting === conn.id ? <><span className="spinner" /> Deleting...</> : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="modal">
            <h2>Add Connection</h2>
            {addError && <div className="error-message">{addError}</div>}
            <form onSubmit={handleAdd}>
              <div className="form-group">
                <label htmlFor="conn-name">Connection Name</label>
                <input id="conn-name" value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. My Bank" autoFocus />
              </div>
              <div className="form-group">
                <label htmlFor="setup-token">Setup Token</label>
                <input id="setup-token" value={setupToken} onChange={e => setSetupToken(e.target.value)}
                  placeholder="Paste the token from SimpleFIN Bridge" />
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Get your token at <a href="https://beta-bridge.simplefin.org/simplefin/create" target="_blank" rel="noopener">beta-bridge.simplefin.org/simplefin/create</a>
              </p>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="primary" disabled={adding}>
                  {adding ? <><span className="spinner" /> Adding...</> : 'Add Connection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
