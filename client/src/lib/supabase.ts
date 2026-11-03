import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import type { Base } from './types';

/** The same shape the own-server /api/sync returns, so the rest of the sync code does not care which one it talks to. */
export interface ExchangeResponse {
  cursor: number;
  more: boolean;
  changes: { table: string; id: string; updatedAt: number; data: Base }[];
  applied?: number;
  rejected?: string[];
}
export interface ExchangeRequest { deviceId: string; cursor: number; changes: unknown[] }
export interface SupabaseConn { url: string; key: string }

/** The supabase-js client is only downloaded when Supabase sync is actually used. */
type Maker = (url: string, key: string) => Promise<SupabaseClient>;
const defaultMaker: Maker = async (url, key) => {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ts-supabase-auth' },
  });
};
let maker: Maker = defaultMaker;
/** For tests: swap in a fake client. */
export function setSupabaseMaker(m: Maker | null): void { maker = m ?? defaultMaker; cache = null; }

let cache: { id: string; client: SupabaseClient } | null = null;
async function clientFor(c: SupabaseConn): Promise<SupabaseClient> {
  const id = `${c.url}|${c.key}`;
  if (cache?.id === id) return cache.client;
  const client = await maker(c.url, c.key);
  cache = { id, client };
  return client;
}

const NETWORK = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;
function offlineError(): TypeError { return new TypeError('offline'); }

export function normalizeSupabaseUrl(u: string): string {
  return u.trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');
}

/** Signs in with the shop's Supabase email and password. The login is remembered on this device. */
export async function supabaseSignIn(c: SupabaseConn, email: string, password: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw offlineError();
  const client = await clientFor(c);
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    if (NETWORK.test(error.message)) throw offlineError();
    if (/invalid login/i.test(error.message)) throw new Error(t('Wrong Supabase email or password'));
    if (/email not confirmed/i.test(error.message)) throw new Error(t('Confirm the email first: open the message Supabase sent you, or turn off "Confirm email" in Supabase.'));
    throw new Error(t('Supabase said: {msg}', { msg: error.message }));
  }
}

export async function supabaseSignOut(c: SupabaseConn): Promise<void> {
  try { await (await clientFor(c)).auth.signOut(); } catch { /* signing out is best effort */ }
}

export async function supabaseExchange(c: SupabaseConn, req: ExchangeRequest): Promise<ExchangeResponse> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw offlineError();
  const client = await clientFor(c);
  const { data: s } = await client.auth.getSession();
  if (!s.session) throw new Error(t('Sign in to Supabase again in Settings'));
  const { data, error } = await client.rpc('sync_exchange', { p_device: req.deviceId, p_cursor: req.cursor, p_changes: req.changes });
  if (error) {
    const msg = error.message ?? '';
    if (NETWORK.test(msg)) throw offlineError();
    if (error.code === '42501' || /not allowed/i.test(msg)) throw new Error(t('This Supabase login is not allowed for this shop. Add its email in Supabase (see SUPABASE.md, step 4).'));
    if (/jwt|not authenticated|invalid claim/i.test(msg) || (error as { status?: number }).status === 401) throw new Error(t('Sign in to Supabase again in Settings'));
    if (error.code === 'PGRST202' || /could not find the function/i.test(msg)) throw new Error(t('The Supabase tables are not set up yet. Run supabase/schema.sql in the Supabase SQL Editor.'));
    throw new Error(t('Supabase said: {msg}', { msg }));
  }
  return data as ExchangeResponse;
}
