import type { AppDB } from '../lib/db';
import { normalizeSupabaseUrl, supabaseSignIn } from '../lib/supabase';
import { setSyncConfig, type SyncConfig } from '../lib/sync';
import { t } from '../i18n';
import { Field } from './ui';

/** What the person typed to connect this device to its online home: their own server, or Supabase. */
export interface SyncForm { kind: 'server' | 'supabase'; url: string; key: string; email: string; password: string }
export const EMPTY_SYNC_FORM: SyncForm = { kind: 'server', url: '', key: '', email: '', password: '' };

export function formFromConfig(cfg: SyncConfig): SyncForm {
  return { kind: cfg.kind === 'supabase' ? 'supabase' : 'server', url: cfg.url, key: cfg.key, email: '', password: '' };
}

/**
 * Saves the connection. For Supabase the sign-in is checked first, so a wrong password or address
 * never replaces a working setup. If this device is already signed in with the same project,
 * leaving the password empty keeps that login.
 */
export async function connectSync(db: AppDB, f: SyncForm, current?: SyncConfig): Promise<void> {
  if (f.kind === 'server') { await setSyncConfig(db, { url: f.url, key: f.key, kind: 'server' }); return; }
  const url = normalizeSupabaseUrl(f.url);
  const key = f.key.trim();
  if (!/^(https:\/\/.+\..+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(url)) throw new Error(t('Enter the Supabase Project URL, like https://abcd1234.supabase.co'));
  if (!key) throw new Error(t('Enter the Supabase anon key'));
  const already = current?.kind === 'supabase' && current.url === url && current.key === key;
  if (!(already && !f.password)) {
    if (!f.email.trim() || !f.password) throw new Error(t('Enter the Supabase email and password'));
    await supabaseSignIn({ url, key }, f.email, f.password);
  }
  await setSyncConfig(db, { url, key, kind: 'supabase' });
}

export default function SyncFields({ v, onChange, compact }: { v: SyncForm; onChange: (v: SyncForm) => void; compact?: boolean }) {
  const set = (patch: Partial<SyncForm>) => onChange({ ...v, ...patch });
  return (
    <>
      <Field label={t('Keep the online copy in')} className="span2">
        <select value={v.kind} onChange={(e) => set({ kind: e.target.value as SyncForm['kind'] })}>
          <option value="server">{t('My own server')}</option>
          <option value="supabase">{t('Supabase (online database)')}</option>
        </select>
      </Field>
      {v.kind === 'server' ? (
        <>
          <Field label={t('Server address')} hint={compact ? t('Leave empty if you opened this app from the server itself.') : t('Empty = the server this app was opened from')}>
            <input type="url" value={v.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://your-server.example.com" />
          </Field>
          <Field label={t('Sync key')}><input type="password" value={v.key} onChange={(e) => set({ key: e.target.value })} autoComplete="off" /></Field>
        </>
      ) : (
        <>
          <Field label={t('Supabase Project URL')} hint={t('Supabase > Project Settings > API')}>
            <input type="url" value={v.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://abcd1234.supabase.co" />
          </Field>
          <Field label={t('Supabase anon key')} hint={t('The public "anon" key, not the "service_role" key')}>
            <input type="password" value={v.key} onChange={(e) => set({ key: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t('Supabase email')}><input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} autoComplete="username" autoCapitalize="none" /></Field>
          <Field label={t('Supabase password')}><input type="password" value={v.password} onChange={(e) => set({ password: e.target.value })} autoComplete="current-password" /></Field>
        </>
      )}
    </>
  );
}
