import { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function ResetPassword({ onLogin }) {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [error, setError] = useState('');

  useEffect(() => {
    const hashQuery = window.location.hash.split('?')[1] || '';
    const params = new URLSearchParams(hashQuery);
    setToken(params.get('token') || '');
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) { setError('Invalid reset link.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setStatus('loading');
    setError('');
    try {
      await api.resetPassword(token, password);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div className="card" style={{ width: 360 }}>
        {status === 'success' ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <h2 style={{ color: 'var(--success)', marginBottom: 8 }}>Password Reset!</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
              Your password has been changed. You can now sign in.
            </p>
            <a href="#/login" className="btn primary" style={{ display: 'block', textAlign: 'center' }}>Sign In</a>
          </>
        ) : (
          <>
            <h2 style={{ marginBottom: 24 }}>New Password</h2>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>New Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required minLength={8} autoFocus placeholder="At least 8 characters" />
              </div>
              <button type="submit" className="primary" disabled={status === 'loading'} style={{ width: '100%' }}>
                {status === 'loading' ? <><span className="spinner" /> Saving...</> : 'Save New Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
