import { useState } from 'react';
import { api } from '../api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div className="card" style={{ width: 360 }}>
        {done ? (
          <>
            <h2 style={{ marginBottom: 8 }}>Check Your Email</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              If an account with <strong>{email}</strong> exists, we've sent a password reset link.
              Check your inbox (and spam folder).
            </p>
            <a href="#/login" className="btn primary" style={{ marginTop: 20, display: 'block', textAlign: 'center' }}>Back to Sign In</a>
          </>
        ) : (
          <>
            <h2 style={{ marginBottom: 8 }}>Reset Password</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '0.875rem' }}>
              Enter your email and we'll send a reset link.
            </p>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
              </div>
              <button type="submit" className="primary" disabled={loading} style={{ width: '100%' }}>
                {loading ? <><span className="spinner" /> Sending...</> : 'Send Reset Link'}
              </button>
            </form>
            <div style={{ marginTop: 16, textAlign: 'center', fontSize: '0.85rem' }}>
              <a href="#/login" style={{ color: 'var(--accent)' }}>Back to Sign In</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
