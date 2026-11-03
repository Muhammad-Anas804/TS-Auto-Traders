import { useState } from 'react';
import { createUser, setSession } from '../lib/auth';
import { DEFAULT_SHOP, db } from '../lib/db';
import { loadSampleData } from '../lib/seed';
import { clearSyncConfig, getSyncConfig, syncNow } from '../lib/sync';
import SyncFields, { connectSync, EMPTY_SYNC_FORM, type SyncForm } from '../components/SyncFields';
import type { ShopSettings } from '../lib/types';
import { Field } from '../components/ui';
import { useToast } from '../state';
import LangSwitch from '../components/LangSwitch';
import { t } from '../i18n';

export default function Setup({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'new' | 'join'>('new');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [f, setF] = useState({
    shop: 'TS Auto Trader', address: '', phone: '', ownerName: '', username: 'owner', password: '', password2: '',
    prefix: '', startNo: '1', sample: false,
  });
  const [j, setJ] = useState<SyncForm>(EMPTY_SYNC_FORM);
  const [jPrefix, setJPrefix] = useState('B-');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const createShop = async () => {
    setErr('');
    if (!f.shop.trim()) return setErr(t('Enter your shop name'));
    if (!f.username.trim()) return setErr(t('Enter a username for the owner login'));
    if (f.password.length < 4) return setErr(t('Password must be at least 4 characters'));
    if (f.password !== f.password2) return setErr(t('The two passwords do not match'));
    setBusy(true);
    try {
      await db.put<ShopSettings>('settings', {
        ...DEFAULT_SHOP, name: f.shop.trim(), address: f.address.trim(), phone: f.phone.trim(),
      });
      await db.setDevicePrefix(f.prefix);
      await db.setCounter('sale', Math.max(1, Number(f.startNo) || 1));
      const u = await createUser(db, { username: f.username, name: f.ownerName || f.username, password: f.password, role: 'owner' });
      if (f.sample) await loadSampleData(db);
      setSession(u.id);
      toast(t('Shop created. Welcome!'), 'ok');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  const join = async () => {
    setErr('');
    if (j.kind === 'server' && !j.key.trim()) return setErr(t('Enter the sync key from your server'));
    if (!jPrefix.trim()) return setErr(t('Give this device its own invoice prefix (for example B-) so numbers never clash'));
    setBusy(true);
    try {
      await connectSync(db, j);
      await db.setDevicePrefix(jPrefix);
      const r = await syncNow(db);
      if (!r.ok) throw new Error(r.error ?? 'sync failed') // i18n-ok;
      if ((await db.users.count()) === 0) throw new Error(t('Connected, but the server has no shop yet. Create the shop on your first device and sync it, then try again.'));
      toast(t('Connected. Received {n} records.', { n: r.pulled }), 'ok');
      onDone();
    } catch (e) {
      await clearSyncConfig(db);
      setErr(e instanceof TypeError ? t('Offline (server not reachable)') : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><LangSwitch /></div>
        <div className="brand"><img src="/icon.svg" alt="" /> TS Auto Trader</div>
        <div className="tabs">
          <button className={mode === 'new' ? 'on' : ''} onClick={() => { setMode('new'); setErr(''); }}>{t('Set up a new shop')}</button>
          <button className={mode === 'join' ? 'on' : ''} onClick={() => { setMode('join'); setErr(''); }}>{t('Connect another device')}</button>
        </div>
        {err && <div className="alert bad mb">{err}</div>}
        {mode === 'new' ? (
          <form className="col" onSubmit={(e) => { e.preventDefault(); void createShop(); }}>
            <div className="form-grid">
              <Field label={t('Shop name')} className="span2"><input type="text" value={f.shop} onChange={set('shop')} /></Field>
              <Field label={t('Address (printed on invoices)')} className="span2"><input type="text" value={f.address} onChange={set('address')} /></Field>
              <Field label={t('Phone')}><input type="tel" value={f.phone} onChange={set('phone')} /></Field>
              <Field label={t('Owner name')}><input type="text" value={f.ownerName} onChange={set('ownerName')} /></Field>
              <Field label={t('Owner username')}><input type="text" value={f.username} onChange={set('username')} autoCapitalize="none" /></Field>
              <span />
              <Field label={t('Password')}><input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
              <Field label={t('Repeat password')}><input type="password" value={f.password2} onChange={set('password2')} autoComplete="new-password" /></Field>
              <Field label={t('Invoice number starts at')} hint={t('Continue from your paper book, e.g. 5511')}><input type="number" value={f.startNo} onChange={set('startNo')} min={1} /></Field>
              <Field label={t('Invoice prefix (optional)')} hint={t('Leave empty if you use one device. Use A-, B- … for several.')}><input type="text" value={f.prefix} onChange={set('prefix')} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={f.sample} onChange={set('sample')} /> {t('Add sample items from invoice 5510 so I can try the app')}</label>
            <button className="btn primary" disabled={busy}>{busy ? t('Creating…') : t('Create shop and sign in')}</button>
            <p className="hint" style={{ margin: 0 }}>{t('Everything is stored on this device first, so it works with no internet. You can set up syncing between devices later in Settings.')}</p>
          </form>
        ) : (
          <form className="col" onSubmit={(e) => { e.preventDefault(); void join(); }}>
            <p className="muted" style={{ margin: 0 }}>{t('Use this on a second phone or computer to load the same shop. Choose where the shop is kept online and enter its details.')}</p>
            <SyncFields v={j} onChange={setJ} compact />
            <Field label={t("This device's invoice prefix")} hint={t('Must be different on every device, e.g. B-')}><input type="text" value={jPrefix} onChange={(e) => setJPrefix(e.target.value)} /></Field>
            <button className="btn primary" disabled={busy}>{busy ? t('Connecting…') : t('Connect and download shop')}</button>
          </form>
        )}
      </div>
    </div>
  );
}

export async function hasSyncConfigured(): Promise<boolean> {
  return !!(await getSyncConfig(db)).key;
}
