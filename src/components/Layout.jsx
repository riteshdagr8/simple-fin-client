import { useState } from 'react';

export default function Layout({ children, currentPage, onNavigate, user, onLogout }) {
  const [showUserMenu, setShowUserMenu] = useState(false);

  const navItems = [
    { key: 'dashboard',    label: 'Dashboard' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'transfers',    label: 'Transfers' },
    { key: 'accounts',     label: 'Accounts' },
    { key: 'connections',  label: 'Connections' },
    { key: 'categories',   label: 'Categories' },
    { key: 'receipts',     label: 'Receipts' },
  ];

  const settingsItems = [
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div className="app-layout">
      <header className="app-header">
        <a href="#/dashboard" className="logo"
           onClick={e => { e.preventDefault(); onNavigate('dashboard'); }}>
          Simple Finance Client
        </a>
        <div className="header-actions">
          <span className="header-user">{user?.name}</span>
          <div style={{ position: 'relative' }}>
            <button
              className="link"
              onClick={() => setShowUserMenu(!showUserMenu)}
              style={{ whiteSpace: 'nowrap' }}
            >
              {user?.name} ▾
            </button>
            {showUserMenu && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)',
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
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <nav>
            {navItems.map(({ key, label }) => (
              <a key={key} href={`#/${key}`}
                 className={currentPage === key ? 'active' : ''}
                 onClick={e => { e.preventDefault(); onNavigate(key); }}>
                {label}
              </a>
            ))}
            <div className="nav-section">
              {settingsItems.map(({ key, label }) => (
                <a key={key} href={`#/${key}`}
                   className={currentPage === key ? 'active' : ''}
                   onClick={e => { e.preventDefault(); onNavigate(key); }}>
                  {label}
                </a>
              ))}
            </div>
          </nav>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
