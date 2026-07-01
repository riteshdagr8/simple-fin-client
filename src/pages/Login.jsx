import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login(email, password);
      onLogin(res.token, res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div className="card" style={{ width: 360 }}>
        <h1 style={{ marginBottom: 8 }}>Sign In</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '0.875rem' }}>to your Simple Finance Client account</p>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="primary" disabled={loading} style={{ width: '100%' }}>
            {loading ? <><span className="spinner" /> Signing in...</> : 'Sign In'}
          </button>
        </form>
        <div style={{ marginTop: 16, textAlign: 'center', fontSize: '0.85rem' }}>
          <a href="#/forgot-password" style={{ color: 'var(--accent)' }}>Forgot password?</a>
          {' · '}
          <a href="#/register" style={{ color: 'var(--accent)' }}>Create account</a>
        </div>
      </div>
    </div>
  );
}
