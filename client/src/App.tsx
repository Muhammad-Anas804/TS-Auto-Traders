import { useEffect, useState, useCallback } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, requestPersistence } from './lib/db';
import { logout as doLogout, sessionUserId, type Perm } from './lib/auth';
import { startAutoSync } from './lib/sync';
import { AppProvider, useApp, useToast } from './state';
import SyncBadge from './components/SyncBadge';
import LangSwitch from './components/LangSwitch';
import { t, tk, useLang } from './i18n';
import Calculator from './components/Calculator';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Items from './pages/Items';
import Parties from './pages/Parties';
import PartyDetail from './pages/PartyDetail';
import DocEditor from './pages/DocEditor';
import DocList from './pages/DocList';
import DocView from './pages/DocView';
import Payments from './pages/Payments';
import Reports from './pages/Reports';
import UsersPage from './pages/Users';
import Settings from './pages/Settings';

type Phase = 'loading' | 'setup' | 'login' | 'app';

export default function App() {
  useLang(); // re-render the whole tree when the language changes
  const [phase, setPhase] = useState<Phase>('loading');
  const [userId, setUserId] = useState<string | null>(null);

  const decide = useCallback(async () => {
    await db.open();
    void requestPersistence();
    const users = (await db.users.toArray()).filter((u) => !u.deleted);
    if (users.length === 0) { setPhase('setup'); return; }
    const sid = sessionUserId();
    const u = sid ? users.find((x) => x.id === sid && x.active) : undefined;
    if (u) { setUserId(u.id); setPhase('app'); } else setPhase('login');
  }, []);
  useEffect(() => { void decide(); }, [decide]);

  if (phase === 'loading') return <div className="login-wrap"><div className="login-card center">{t('Loading…')}</div></div>;
  if (phase === 'setup') return <Setup onDone={() => void decide()} />;
  if (phase === 'login') return <Login onDone={() => void decide()} />;
  return (
    <HashRouter>
      <Authed userId={userId!} onLogout={() => { doLogout(); setUserId(null); setPhase('login'); }} />
    </HashRouter>
  );
}

function Authed({ userId, onLogout }: { userId: string; onLogout: () => void }) {
  const user = useLiveQuery(() => db.users.get(userId), [userId]);
  const shop = useLiveQuery(() => db.getShop(), []);
  useEffect(() => startAutoSync(db), []);
  useEffect(() => { if (user && (user.deleted || !user.active)) onLogout(); }, [user, onLogout]);
  if (!user || !shop) return <div className="login-wrap"><div className="login-card center">{t('Loading…')}</div></div>;
  return (
    <AppProvider user={user} shop={shop} logout={onLogout}>
      <Shell />
    </AppProvider>
  );
}

interface NavItem { to: string; label: string; ico: string; perm?: Perm | Perm[] }
const NAV: (NavItem | 'sep')[] = [
  { to: '/', label: tk('Dashboard'), ico: '🏠' },
  { to: '/new/sale', label: tk('New sale'), ico: '➕', perm: 'sales' },
  { to: '/sales', label: tk('Sales'), ico: '🧾', perm: 'sales' },
  { to: '/purchases', label: tk('Purchases'), ico: '📦', perm: 'purchases' },
  { to: '/returns', label: tk('Returns'), ico: '↩️', perm: ['sales', 'purchases'] },
  'sep',
  { to: '/items', label: tk('Items & stock'), ico: '🔧' },
  { to: '/customers', label: tk('Customers'), ico: '👥', perm: ['sales', 'parties.edit', 'payments'] },
  { to: '/suppliers', label: tk('Suppliers'), ico: '🚚', perm: ['suppliers', 'purchases'] },
  { to: '/payments', label: tk('Payments'), ico: '💵', perm: 'payments' },
  'sep',
  { to: '/reports', label: tk('Reports'), ico: '📊', perm: 'reports' },
  { to: '/users', label: tk('Users'), ico: '🔑', perm: 'settings' },
  { to: '/settings', label: tk('Settings'), ico: '⚙️', perm: 'settings' },
];

const ROLE_LABEL = { owner: tk('Owner'), salesman: tk('Salesman'), storekeeper: tk('Storekeeper') };

function Shell() {
  const { user, shop, can, logout } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [calc, setCalc] = useState(false);
  const loc = useLocation();
  const [installEvt, setInstallEvt] = useState<any>(null);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    const key = (e: KeyboardEvent) => { if (e.altKey && e.key.toLowerCase() === 'c') { e.preventDefault(); setCalc((c) => !c); } };
    window.addEventListener('keydown', key);
    const ready = () => toast(t('Ready to work offline'), 'ok');
    window.addEventListener('beforeinstallprompt', h);
    window.addEventListener('ts-offline-ready', ready);
    return () => { window.removeEventListener('beforeinstallprompt', h); window.removeEventListener('ts-offline-ready', ready); window.removeEventListener('keydown', key); };
  }, [toast]);

  const allowed = (p?: Perm | Perm[]) => !p || (Array.isArray(p) ? p.some(can) : can(p));

  return (
    <div className={`app ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar no-print">
        <div className="brand"><img src="/icon.svg" alt="" />{shop.name}</div>
        <nav className="nav">
          {NAV.map((n, i) => n === 'sep' ? <div key={i} className="sep" /> : allowed(n.perm) && (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}><span className="ico">{n.ico}</span>{t(n.label) /* i18n-ok */}</NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', padding: '14px 10px 4px', fontSize: 13 }}>
          {installEvt && <button className="btn sm amber" style={{ width: '100%', marginBottom: 10 }} onClick={async () => { installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null); }}>{t('Install app')}</button>}
          <div style={{ color: '#fff', fontWeight: 600 }}>{user.name}</div>
          <div style={{ opacity: .7 }}>{t(ROLE_LABEL[user.role]) /* i18n-ok */}</div>
          <button className="btn sm" style={{ marginTop: 8, width: '100%' }} onClick={logout}>{t('Sign out')}</button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar no-print">
          <button className="btn sm menu-btn" onClick={() => setOpen(true)} aria-label={t('Menu')}>☰</button>
          <span className="shopname">{shop.name}</span>
          <span className="grow" />
          <button className="btn sm" onClick={() => setCalc((c) => !c)} title={t('Calculator (Alt+C)')} aria-label={t('Calculator')} aria-pressed={calc}>🧮 <span className="calc-label">{t('Calculator')}</span></button>
          <LangSwitch />
          <SyncBadge />
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/sales" element={<Guard perm="sales"><DocList kinds={['sale']} title={t('Sales invoices')} newTo="/new/sale" /></Guard>} />
            <Route path="/purchases" element={<Guard perm="purchases"><DocList kinds={['purchase']} title={t('Purchases')} newTo="/new/purchase" /></Guard>} />
            <Route path="/returns" element={<Returns />} />
            <Route path="/new/:kind" element={<DocEditor />} />
            <Route path="/edit/:id" element={<DocEditor />} />
            <Route path="/doc/:id" element={<DocView />} />
            <Route path="/items" element={<Items />} />
            <Route path="/customers" element={<Parties type="customer" />} />
            <Route path="/suppliers" element={<Guard perm="suppliers"><Parties type="supplier" /></Guard>} />
            <Route path="/party/:id" element={<PartyDetail />} />
            <Route path="/payments" element={<Guard perm="payments"><Payments /></Guard>} />
            <Route path="/reports" element={<Guard perm="reports"><Reports /></Guard>} />
            <Route path="/users" element={<Guard perm="settings"><UsersPage /></Guard>} />
            <Route path="/settings" element={<Guard perm="settings"><Settings /></Guard>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      {calc && <Calculator onClose={() => setCalc(false)} />}
    </div>
  );
}

function Guard({ perm, children }: { perm: Perm; children: React.ReactNode }) {
  const { can } = useApp();
  if (!can(perm)) return <div className="card"><h2>{t('Not allowed')}</h2><p className="muted">{t('Your role does not have access to this page.')}</p></div>;
  return <>{children}</>;
}

function Returns() {
  const { can } = useApp();
  const [tab, setTab] = useState<'sale_return' | 'purchase_return'>(can('sales') ? 'sale_return' : 'purchase_return');
  return (
    <>
      <div className="tabs no-print">
        {can('sales') && <button className={tab === 'sale_return' ? 'on' : ''} onClick={() => setTab('sale_return')}>{t('Sale returns (from customers)')}</button>}
        {can('purchases') && <button className={tab === 'purchase_return' ? 'on' : ''} onClick={() => setTab('purchase_return')}>{t('Purchase returns (to suppliers)')}</button>}
      </div>
      <DocList key={tab} kinds={[tab]} title={tab === 'sale_return' ? t('Sale returns') : t('Purchase returns')} newTo={`/new/${tab}`} />
    </>
  );
}
