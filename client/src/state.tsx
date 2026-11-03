import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { can as canRole, type Perm } from './lib/auth';
import type { ShopSettings, User } from './lib/types';

export type ToastKind = 'info' | 'ok' | 'err';
interface Toast { id: number; msg: string; kind: ToastKind }

interface Ctx {
  user: User;
  shop: ShopSettings;
  can: (p: Perm) => boolean;
  toast: (msg: string, kind?: ToastKind) => void;
  logout: () => void;
}
const AppCtx = createContext<Ctx | null>(null);
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider'); // i18n-ok (developer error)
  return c;
}
export const useToast = () => useContext(ToastCtx);

export function AppProvider({ user, shop, logout, children }: { user: User; shop: ShopSettings; logout: () => void; children: ReactNode }) {
  const toast = useToast();
  const value = useMemo<Ctx>(
    () => ({ user, shop, logout, toast, can: (p) => canRole(user.role, p) }),
    [user, shop, logout, toast],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6500 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'info' ? '' : t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/** True while the browser reports a network connection. */
export function useOnline(): boolean {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}
