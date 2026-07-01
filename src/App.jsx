import { useState, useEffect, createContext, useContext } from 'react';
import { setToken, clearToken, getToken, api } from './api.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import VerifyEmail from './pages/VerifyEmail.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Connections from './pages/Connections.jsx';
import Accounts from './pages/Accounts.jsx';
import Transactions from './pages/Transactions.jsx';
import Categories from './pages/Categories.jsx';
import Receipts from './pages/Receipts.jsx';
import Settings from './pages/Settings.jsx';

export const AuthContext = createContext(null);

const PAGES = {
  dashboard:    { component: Dashboard },
  connections:  { component: Connections },
  accounts:     { component: Accounts },
  transactions: { component: Transactions },
  categories:   { component: Categories },
  receipts:     { component: Receipts },
  settings:     { component: Settings },
};

const AUTH_PAGES = {
  'login':           Login,
  'register':        Register,
  'verify-email':   VerifyEmail,
  'forgot-password':ForgotPassword,
  'reset-password': ResetPassword,
};

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('finapp_theme') || 'cloud';
  });

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('finapp_theme', theme);
  }, [theme]);

  // Load token on mount
  useEffect(() => {
    const token = localStorage.getItem('finapp_token');
    if (token) {
      setToken(token);
      api.me().then(u => {
        setUser(u);
        setLoading(false);
      }).catch(() => {
        clearToken();
        localStorage.removeItem('finapp_token');
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  // Load user's saved theme after login
  useEffect(() => {
    if (user) {
      api.getSyncSettings()
        .then(s => { if (s.ui_theme) setTheme(s.ui_theme); })
        .catch(() => {});
    }
  }, [user]);

  // Hash routing
  useEffect(() => {
    const onHash = () => {
      const raw = window.location.hash.replace('#/', '').replace('#', '') || 'dashboard';
      const hash = raw.split('?')[0];
      if (AUTH_PAGES[hash]) {
        setPage(hash);
      } else if (PAGES[hash] || Object.keys(PAGES).includes(hash)) {
        setPage(hash);
      } else {
        setPage('dashboard');
      }
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const handleLogin = (token, userData) => {
    setToken(token);
    localStorage.setItem('finapp_token', token);
    setUser(userData);
    window.location.hash = '#/dashboard';
    setPage('dashboard');
  };

  const handleLogout = () => {
    clearToken();
    localStorage.removeItem('finapp_token');
    setUser(null);
    window.location.hash = '#/login';
    setPage('login');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  // Show auth pages when not logged in
  if (!user) {
    const AuthPage = AUTH_PAGES[page] || Login;
    return <AuthPage onLogin={handleLogin} />;
  }

  const Component = PAGES[page]?.component || Dashboard;

  return (
    <AuthContext.Provider value={{ user, handleLogout }}>
      <Layout currentPage={page} onNavigate={setPage} user={user} onLogout={handleLogout}>
        <Component key={page} theme={theme} setTheme={setTheme} />
      </Layout>
    </AuthContext.Provider>
  );
}
