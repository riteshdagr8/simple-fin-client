import { useState } from 'react';

export default function Layout({ children, currentPage, onNavigate, user, onLogout }) {
  const [showUserMenu, setShowUserMenu] = useState(false);

  const navItems = [
    { key: 'dashboard',    label: 'Dashboard' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'accounts',     label: 'Accounts' },
    { key: 'connections',  label: 'Connections' },
    { key: 'categories',   label: 'Categories' },
    { key: 'settings',     label: 'Settings' },
  ];

  return (
    <div className="app-layout">
      <nav>
        <a href="#/dashboard" className="logo"
           onClick={e => { e.preventDefault(); onNavigate('dashboard'); }}>
          FinApp
        </a>
        {navItems.map(({ key, label }) => (
          <a key={key} href={`#/${key}`}
             className={currentPage === key ? 'active' : ''}
             onClick={e => { e.preventDefault(); onNavigate(key); }}>
            {label}
          </a>
        ))}
        <div style={{ marginLeft: 'auto', position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 12px', cursor: 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
          >
            {user?.name} ▾
          </button>
          {showUserMenu && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', marginTop: 4,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              minWidth: 160, zIndex: 50,
            }}>
              <a href="#/settings" onClick={e => { e.preventDefault(); onNavigate('settings'); setShowUserMenu(false); }}
                 style={{ display: 'block', padding: '10px 16px', color: 'var(--text)', textDecoration: 'none', fontSize: '0.875rem' }}>
                Settings
              </a>
              <button onClick={() => { setShowUserMenu(false); onLogout(); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: '0.875rem' }}>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
