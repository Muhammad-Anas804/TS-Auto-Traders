import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { logout } from '../lib/auth';
import { db } from '../lib/db';
import { download } from '../lib/csv';
import { loadSampleData } from '../lib/seed';
import { clearSyncConfig, getSyncConfig, getSyncState, subscribeSyncState, syncNow } from '../lib/sync';
import SyncFields, { connectSync, EMPTY_SYNC_FORM, formFromConfig, type SyncForm } from '../components/SyncFields';
import { fmtDate, todayISO } from '../lib/money';
import type { Base, DocKind, ShopSettings } from '../lib/types';
import { usePending } from '../hooks';
import { useApp } from '../state';
import { Field, PageHead, useConfirm } from '../components/ui';
import LangSwitch from '../components/LangSwitch';
import { t, tk } from '../i18n';

export default function Settings() {
  return (
    <>
      <PageHead title={t('Settings')} />
      <div className="col gap-lg">
        <div className="card"><div className="row" style={{ justifyContent: 'space-between' }}><b>{t('Screen language')}</b><LangSwitch /></div></div>
        <ShopCard />
        <NumberingCard />
        <SyncCard />
        <BackupCard />
        <DeviceCard />
      </div>
    </>
  );
}

function ShopCard() {
  const { shop, toast } = useApp();
  const [f, setF] = useState(shop);
  const set = (k: keyof ShopSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const save = async () => {
    await db.put<ShopSettings>('settings', { ...f, defaultDiscountPct: Number(f.defaultDiscountPct) || 0 });
    toast(t('Settings saved'), 'ok');
  };
  return (
    <div className="card">
      <h2>{t('Shop and invoice')}</h2>
      <div className="form-grid">
        <Field label={t('Shop name')}><input type="text" value={f.name} onChange={set('name')} /></Field>
        <Field label={t('Phone')}><input type="text" value={f.phone} onChange={set('phone')} /></Field>
        <Field label={t('Email')}><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label={t('NTN / STRN (optional)')}><input type="text" value={f.taxNo} onChange={set('taxNo')} /></Field>
        <Field label={t('Address (printed under the shop name)')} className="span2"><input type="text" value={f.address} onChange={set('address')} /></Field>
        <Field label={t('Default terms of payment')} className="span2"><input type="text" value={f.invoiceTerms} onChange={set('invoiceTerms')} /></Field>
        <Field label={t('Invoice footer')} className="span2"><input type="text" value={f.invoiceFooter} onChange={set('invoiceFooter')} /></Field>
        <Field label={t('Invoice language')} hint={t('Language printed on invoices. The screen language can be changed any time with the language button.')} className="span2">
          <select aria-label={t('Invoice language')} value={f.invoiceLang ?? 'en'} onChange={(e) => setF({ ...f, invoiceLang: e.target.value as 'en' | 'ur' | 'both' })}>
            <option value="en">English</option><option value="ur">اردو</option><option value="both">Both / دونوں</option></select></Field>
        <Field label={t('Default discount % for new customers')} hint={t('Used when neither the item nor the customer has its own')}><input type="number" step="any" value={f.defaultDiscountPct} onChange={set('defaultDiscountPct')} /></Field>
      </div>
      <div className="col mt">
        <label className="check"><input type="checkbox" checked={f.roundDiscountToRupee} onChange={set('roundDiscountToRupee')} /> {t('Round percentage discounts to a whole rupee (like your paper invoice: 12% of 490 = 59)')}</label>
        <label className="check"><input type="checkbox" checked={f.allowNegativeStock} onChange={set('allowNegativeStock')} /> {t('Allow selling more than the stock shown (only warn)')}</label>
      </div>
      <div className="mt"><button className="btn primary" onClick={save}>{t('Save settings')}</button></div>
    </div>
  );
}

const KIND_LABEL: Record<DocKind, string> = { sale: tk('Sale invoice'), purchase: tk('Purchase'), sale_return: tk('Sale return'), purchase_return: tk('Purchase return') };

const kindName = (k: DocKind) => t(KIND_LABEL[k]).toLowerCase(); // i18n-ok

function NumberingCard() {
  const { toast } = useApp();
  const [prefix, setPrefix] = useState('');
  const [counters, setCounters] = useState<Record<DocKind, string>>({ sale: '1', purchase: '1', sale_return: '1', purchase_return: '1' });
  useEffect(() => {
    void (async () => {
      setPrefix(await db.devicePrefix());
      const c = {} as Record<DocKind, string>;
      for (const k of Object.keys(KIND_LABEL) as DocKind[]) c[k] = String(await db.getCounter(k));
      setCounters(c);
    })();
  }, []);
  const save = async () => {
    await db.setDevicePrefix(prefix);
    for (const k of Object.keys(KIND_LABEL) as DocKind[]) await db.setCounter(k, Number(counters[k]) || 1);
    toast(t('Numbering saved. Numbers already used are skipped automatically.'), 'ok');
  };
  return (
    <div className="card">
      <h2>{t('Invoice numbering (this device)')}</h2>
      <p className="muted small" style={{ marginTop: 0 }}>{t('If you use more than one device, give each its own prefix (A-, B-, …) so two devices can never issue the same number while offline.')}</p>
      <div className="form-grid">
        <Field label={t('Prefix for this device')}><input type="text" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder={t('(none)')} /></Field>
        {(Object.keys(KIND_LABEL) as DocKind[]).map((k) => (
          <Field key={k} label={t('Next {kind} number', { kind: kindName(k) })}>
            <input type="number" min={1} value={counters[k]} onChange={(e) => setCounters({ ...counters, [k]: e.target.value })} /></Field>
        ))}
      </div>
      <div className="mt"><button className="btn primary" onClick={save}>{t('Save numbering')}</button></div>
    </div>
  );
}

function SyncCard() {
  const { toast } = useApp();
  const cfg = useLiveQuery(() => getSyncConfig(db), []);
  const last = useLiveQuery(() => db.getMeta<number>('lastSyncAt', 0), [], 0);
  const pending = usePending();
  const st = useSyncExternalStore(subscribeSyncState, getSyncState);
  const [form, setForm] = useState<SyncForm>(EMPTY_SYNC_FORM);
  useEffect(() => { if (cfg) setForm(formFromConfig(cfg)); }, [cfg]);
  const save = async () => {
    try {
      await connectSync(db, form, cfg);
    } catch (e) {
      toast(e instanceof TypeError ? t('Offline (server not reachable)') : (e as Error).message, 'err');
      return;
    }
    setForm((f) => ({ ...f, password: '' }));
    const r = await syncNow(db);
    toast(r.ok ? t('Connected. Sent {sent}, received {got}.', { sent: r.pushed, got: r.pulled }) : r.error ?? t('Failed'), r.ok ? 'ok' : 'err');
  };
  return (
    <div className="card">
      <h2>{t('Sync between devices')}</h2>
      <p className="muted small" style={{ marginTop: 0 }}>{t('Everything is saved on this device first, so you can keep billing with no internet. When a connection is available, changes are sent to the online copy (your own server or Supabase) and other devices pick them up. Leave empty to work on this device only.')}</p>
      <div className="form-grid">
        <SyncFields v={form} onChange={setForm} />
      </div>
      <div className="row mt">
        <button className="btn primary" onClick={save} disabled={st.syncing}>{t('Save and sync now')}</button>
        {cfg?.key && <button className="btn" onClick={async () => { const r = await syncNow(db); toast(r.ok ? t('Synced (sent {sent}, received {got})', { sent: r.pushed, got: r.pulled }) : r.error ?? t('Failed'), r.ok ? 'ok' : 'err'); }}>{t('Sync now')}</button>}
        {cfg?.key && <button className="btn danger" onClick={async () => { await clearSyncConfig(db); toast(t('Sync turned off')); }}>{t('Turn off')}</button>}
      </div>
      <p className="small mt" style={{ marginBottom: 0 }}>
        {pending === 1 ? t('1 change waiting to send') : t('{n} changes waiting to send', { n: pending })} ·{' '}
        {last ? t('last synced {when}', { when: new Date(last).toLocaleString() }) : t('never synced')}
        {st.lastError && <span className="neg"> · {st.lastError}</span>}
      </p>
    </div>
  );
}

function BackupCard() {
  const { toast } = useApp();
  const last = useLiveQuery(() => db.getMeta<number>('lastBackupAt', 0), [], 0);
  const { ask, dialog } = useConfirm();
  const exportAll = async () => {
    const data = await db.exportAll();
    download(`ts-auto-trader-backup-${todayISO()}.json`, JSON.stringify({ app: 'ts-auto-trader', version: 1, exportedAt: Date.now(), data }), 'application/json');
    await db.setMeta('lastBackupAt', Date.now());
    toast(t('Backup downloaded. Keep it somewhere safe (WhatsApp it to yourself or save to Drive).'), 'ok');
  };
  const importAll = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      if (json.app !== 'ts-auto-trader' || !json.data) throw new Error(t('This is not a TS Auto Trader backup file'));
      if (!(await ask(t('Restore from this backup?\n\nRecords newer than the ones on this device will be added or updated. Nothing is deleted.'), { ok: t('Restore') }))) return;
      const n = await db.importAll(json.data as Record<string, Base[]>);
      toast(t('Restored {n} records', { n }), 'ok');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div className="card">
      <h2>{t('Backup and restore')}</h2>
      <p className="muted small" style={{ marginTop: 0 }}>{t('A backup file contains all items, customers, invoices, payments and users.')} {last ? t('Last backup: {date}.', { date: fmtDate(todayISO(new Date(last))) }) : t('You have not made a backup yet.')}</p>
      <div className="row">
        <button className="btn primary" onClick={exportAll}>{t('Download backup')}</button>
        <label className="btn">{t('Restore from file')}<input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importAll(f); e.target.value = ''; }} /></label>
      </div>
      {dialog}
    </div>
  );
}

function DeviceCard() {
  const { toast } = useApp();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState('');
  const { ask, dialog } = useConfirm();
  const pending = usePending();
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted);
    void navigator.storage?.estimate?.().then((e) => { if (e.usage != null) setUsage(t('{n} MB used', { n: (e.usage / 1048576).toFixed(1) })); });
  }, []);
  const reset = async () => {
    if (!(await ask(pending
      ? t('Erase ALL data on this device?\n\n{n} changes have NOT been sent to the server yet and will be lost.\n\nOther devices and the server keep their copy. You will return to the setup screen.', { n: pending })
      : t('Erase ALL data on this device?\n\nOther devices and the server keep their copy. You will return to the setup screen.'), { ok: t('Erase this device'), danger: true }))) return;
    await db.wipeLocal();
    logout();
    location.reload();
  };
  return (
    <div className="card">
      <h2>{t('This device')}</h2>
      <p className="small" style={{ marginTop: 0 }}>
        {t('Storage protection:')} {persisted === null ? t('unknown') : persisted ? <b className="pos">{t('on (the browser will not clear your data)')}</b> : <b className="neg">{t('off')}</b>}{usage && ` · ${usage}`}
        {persisted === false && <> · <a href="#" onClick={async (e) => { e.preventDefault(); const ok = await navigator.storage.persist(); setPersisted(ok); toast(ok ? t('Protected') : t('The browser refused. Install the app to your home screen and try again.'), ok ? 'ok' : 'err'); }}>{t('turn on')}</a></>}
      </p>
      <div className="row">
        <button className="btn" onClick={async () => { const n = await loadSampleData(db); toast(n ? t('Added {n} sample items', { n }) : t('Sample items are already there'), 'ok'); }}>{t('Add sample items from invoice 5510')}</button>
        <button className="btn danger" onClick={reset}>{t('Erase this device')}</button>
      </div>
      {dialog}
    </div>
  );
}
