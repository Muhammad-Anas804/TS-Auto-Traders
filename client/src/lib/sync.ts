import type { AppDB } from './db';
import type { Base, SyncTable } from './types';
import { SYNC_TABLES } from './types';
import { t } from '../i18n';
import { normalizeSupabaseUrl, supabaseExchange, supabaseSignOut, type ExchangeRequest, type ExchangeResponse } from './supabase';

export interface SyncConfig {
  /** Own server: its address (empty = same origin as the app). Supabase: the Project URL. */
  url: string;
  /** Own server: the sync key. Supabase: the public "anon" (publishable) key. */
  key: string;
  /** Where the shop's data is kept online. Missing = own server (older saved settings). */
  kind?: 'server' | 'supabase';
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  error?: string;
}

interface WireChange { table: SyncTable; id: string; updatedAt: number; data: Base }

export type SyncState = { syncing: boolean; lastError: string | null; lastSyncAt: number | null };
let state: SyncState = { syncing: false, lastError: null, lastSyncAt: null };
const listeners = new Set<() => void>();
export function getSyncState(): SyncState { return state; }
export function subscribeSyncState(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export async function getSyncConfig(db: AppDB): Promise<SyncConfig> {
  return db.getMeta<SyncConfig>('syncConfig', { url: '', key: '' });
}
/** Puts every record on this device back in the outbox, so a brand-new online home receives the whole shop. */
async function queueEverything(db: AppDB): Promise<void> {
  for (const name of SYNC_TABLES) {
    const ids = (await db.table(name).toCollection().primaryKeys()) as string[];
    for (let i = 0; i < ids.length; i += 500) {
      await db.outbox.bulkAdd(ids.slice(i, i + 500).map((rid) => ({ table: name, rid })));
    }
  }
}

export async function setSyncConfig(db: AppDB, cfg: SyncConfig): Promise<void> {
  const kind = cfg.kind === 'supabase' ? 'supabase' : 'server';
  const url = kind === 'supabase' ? normalizeSupabaseUrl(cfg.url) : cfg.url.trim().replace(/\/+$/, '');
  const key = cfg.key.trim();
  const prev = await getSyncConfig(db);
  const moved = (prev.kind ?? 'server') !== kind || prev.url !== url;
  await db.setMeta('syncConfig', { url, key, kind });
  if (moved && key) {
    // A different online home: it has not seen our records, and our old cursor means nothing there.
    await db.setMeta('syncCursor', 0);
    await queueEverything(db);
  }
}
/** Turns syncing off. For Supabase it also signs this device out. */
export async function clearSyncConfig(db: AppDB): Promise<void> {
  const cfg = await getSyncConfig(db);
  if (cfg.kind === 'supabase' && cfg.key) await supabaseSignOut(cfg);
  await setSyncConfig(db, { url: '', key: '', kind: 'server' });
}

/** Talks to the shop's own server (Express + SQLite). */
async function serverExchange(cfg: SyncConfig, fetchImpl: typeof fetch, req: ExchangeRequest): Promise<ExchangeResponse> {
  const res = await fetchImpl(`${cfg.url}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify(req),
  });
  if (res.status === 401 || res.status === 403) throw new Error(t('Wrong sync key'));
  if (res.status === 429) throw new Error(t('Too many attempts, try again later'));
  if (!res.ok) throw new Error(t('Server error {code}', { code: res.status }));
  return (await res.json()) as ExchangeResponse;
}

const PUSH_CHUNK = 200;

/** Applies a record from the server if it is newer than ours (last write wins; device id breaks ties). */
async function applyRemote(db: AppDB, c: WireChange): Promise<boolean> {
  if (!SYNC_TABLES.includes(c.table)) return false;
  const tbl = db.table(c.table);
  const local = (await tbl.get(c.id)) as Base | undefined;
  const r = c.data;
  if (local) {
    if (local.updatedAt > r.updatedAt) return false;
    if (local.updatedAt === r.updatedAt && local.deviceId >= r.deviceId) return false;
  }
  await tbl.put(r);
  return true;
}

let running: Promise<SyncResult> | null = null;

/**
 * One full sync round: push everything in the outbox, pull everything new.
 * Safe to call at any time; concurrent calls share one run. Never throws.
 */
export function syncNow(db: AppDB, fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  if (running) return running;
  running = doSync(db, fetchImpl).finally(() => { running = null; });
  return running;
}

async function doSync(db: AppDB, fetchImpl: typeof fetch): Promise<SyncResult> {
  const cfg = await getSyncConfig(db);
  if (!cfg.key) return { ok: false, pushed: 0, pulled: 0, error: t('Sync is not set up') };
  setState({ syncing: true });
  let pushed = 0;
  let pulled = 0;
  try {
    let cursor = await db.getMeta<number>('syncCursor', 0);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Collapse the outbox to the latest version of each record.
      const pending = await db.outbox.orderBy('seq').limit(PUSH_CHUNK * 5).toArray();
      const unique = new Map<string, { table: SyncTable; rid: string }>();
      for (const e of pending) unique.set(`${e.table}:${e.rid}`, e);
      const batch = [...unique.values()].slice(0, PUSH_CHUNK);
      const batchKeys = new Set(batch.map((b) => `${b.table}:${b.rid}`));
      const changes: WireChange[] = [];
      for (const e of batch) {
        const rec = (await db.table(e.table).get(e.rid)) as Base | undefined;
        if (rec) changes.push({ table: e.table, id: e.rid, updatedAt: rec.updatedAt, data: rec });
      }
      const maxSeq = pending.filter((e) => batchKeys.has(`${e.table}:${e.rid}`)).reduce((m, e) => Math.max(m, e.seq ?? 0), 0);

      const req: ExchangeRequest = { deviceId: db.devId, cursor, changes };
      const body = cfg.kind === 'supabase' ? await supabaseExchange(cfg, req) : await serverExchange(cfg, fetchImpl, req);
      if (body.rejected && body.rejected.length) {
        throw new Error(t("Server rejected some records (check this device's clock): {ids}", { ids: body.rejected.slice(0, 3).join(', ') }));
      }

      // Everything in the batch was accepted: drop its outbox entries (not newer edits).
      if (batch.length) {
        const toDelete = pending.filter((e) => batchKeys.has(`${e.table}:${e.rid}`) && (e.seq ?? 0) <= maxSeq).map((e) => e.seq!);
        await db.outbox.bulkDelete(toDelete);
        pushed += changes.length;
      }

      await db.atomic(async () => {
        for (const c of body.changes as unknown as WireChange[]) if (await applyRemote(db, c)) pulled++;
        await db.setMeta('syncCursor', body.cursor);
      });
      cursor = body.cursor;

      const remaining = batch.length > 0 ? await db.outbox.count() : 0;
      if (!body.more && remaining === 0) break;
    }
    setState({ syncing: false, lastError: null, lastSyncAt: Date.now() });
    await db.setMeta('lastSyncAt', Date.now());
    return { ok: true, pushed, pulled };
  } catch (e) {
    const msg = e instanceof TypeError ? t('Offline (server not reachable)') : (e as Error).message;
    setState({ syncing: false, lastError: msg });
    return { ok: false, pushed, pulled, error: msg };
  }
}

/** Starts background syncing: on a timer, when the browser comes back online, and soon after local edits. */
export function startAutoSync(db: AppDB): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const kick = (delay = 1500) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void syncNow(db); }, delay);
  };
  const onOnline = () => kick(500);
  const onVisible = () => { if (document.visibilityState === 'visible') kick(500); };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(() => { void syncNow(db); }, 30000);
  const onCreate = () => { kick(3000); };
  db.outbox.hook('creating', onCreate);
  kick(1000);
  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(interval);
    if (timer) clearTimeout(timer);
    db.outbox.hook('creating').unsubscribe(onCreate);
  };
}
