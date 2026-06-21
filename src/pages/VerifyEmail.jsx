import { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function VerifyEmail({ onLogin }) {
  const [status, setStatus] = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const hashQuery = window.location.hash.split('?')[1] || '';
    const params = new URLSearchParams(hashQuery);
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setMessage('No verification token provided.');
      return;
    }

    api.verifyEmail(token)
      .then(res => {
        setStatus('success');
        setMessage(`Email verified! Welcome, ${res.name}. Redirecting to login...`);
        setTimeout(() => { window.location.hash = '#/login'; window.location.reload(); }, 2000);
      })
      .catch(err => {
        setStatus('error');
        setMessage(err.message);
      });
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div className="card" style={{ width: 360, textAlign: 'center' }}>
        {status === 'verifying' && (
          <>
            <div className="spinner" style={{ margin: '0 auto 16px', width: 32, height: 32 }} />
            <p>Verifying your email...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <h2 style={{ color: 'var(--success)' }}>Email Verified!</h2>
            <p style={{ color: 'var(--text-secondary)' }}>{message}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✗</div>
            <h2 style={{ color: 'var(--danger)' }}>Verification Failed</h2>
            <p style={{ color: 'var(--text-secondary)' }}>{message}</p>
            <a href="#/register" className="btn primary" style={{ marginTop: 16, display: 'inline-block' }}>Try Again</a>
          </>
        )}
      </div>
    </div>
  );
}
