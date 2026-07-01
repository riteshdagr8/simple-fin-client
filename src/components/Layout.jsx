export default function Layout({ children, currentPage, onNavigate, user, onLogout }) {
  const navItems = [
    { key: 'dashboard',    label: 'Dashboard' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'accounts',     label: 'Accounts' },
    { key: 'connections',  label: 'Connections' },
    { key: 'categories',   label: 'Categories' },
    { key: 'receipts',     label: 'Receipts' },
    { key: 'settings',     label: 'Settings' },
  ];

  return (
    <div className="app-layout">
      <nav>
        <a href="#/dashboard" className="logo"
           onClick={e => { e.preventDefault(); onNavigate('dashboard'); }}>
          Simple Finance Client
        </a>
        {navItems.map(({ key, label }) => (
          <a key={key} href={`#/${key}`}
             className={currentPage === key ? 'active' : ''}
             onClick={e => { e.preventDefault(); onNavigate(key); }}>
            {label}
          </a>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{user?.name}</span>
          <button className="small" onClick={() => onLogout()} style={{ color: 'var(--danger)', borderColor: 'var(--danger)', background: 'transparent' }}>
            Logoff
          </button>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
