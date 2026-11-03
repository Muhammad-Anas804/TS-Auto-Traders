import { describe, expect, it } from 'vitest';
import { AppDB, uuid } from './db';
import { clearSyncConfig, getSyncConfig, setSyncConfig, syncNow } from './sync';
import { setSupabaseMaker } from './supabase';
import { connectSync, EMPTY_SYNC_FORM } from '../components/SyncFields';
import type { Item } from './types';

/** A tiny in-memory stand-in for Supabase: the same rpc('sync_exchange') contract as supabase/schema.sql. */
function fakeSupabase(opts: { signedIn?: boolean; goodPassword?: string; rpcError?: { code?: string; message: string } } = {}) {
  const store = new Map<string, { table: string; id: string; updatedAt: number; deviceId: string; data: Record<string, unknown>; seq: number }>();
  let seq = 0;
  const state = { signedIn: opts.signedIn ?? false, calls: 0, signOuts: 0 };
  const client = {
    auth: {
      signInWithPassword: async ({ password }: { email: string; password: string }) => {
        if (password !== (opts.goodPassword ?? 'right')) return { error: { message: 'Invalid login credentials' } };
        state.signedIn = true; return { error: null };
      },
      getSession: async () => ({ data: { session: state.signedIn ? { access_token: 'x' } : null } }),
      signOut: async () => { state.signedIn = false; state.signOuts++; return { error: null }; },
    },
    rpc: async (_name: string, a: { p_device: string; p_cursor: number; p_changes: { table: string; id: string; updatedAt: number; data: { deviceId: string } }[] }) => {
      state.calls++;
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      let applied = 0;
      for (const c of a.p_changes) {
        const ex = store.get(`${c.table}:${c.id}`);
        if (ex && (ex.updatedAt > c.updatedAt || (ex.updatedAt === c.updatedAt && ex.deviceId >= c.data.deviceId))) continue;
        store.set(`${c.table}:${c.id}`, { table: c.table, id: c.id, updatedAt: c.updatedAt, deviceId: c.data.deviceId, data: c.data, seq: ++seq }); applied++;
      }
      const rows = [...store.values()].filter((r) => r.seq > a.p_cursor).sort((x, y) => x.seq - y.seq);
      return { data: { cursor: rows.length ? rows[rows.length - 1].seq : a.p_cursor, more: false, applied, rejected: [],
        changes: rows.filter((r) => r.deviceId !== a.p_device).map((r) => ({ table: r.table, id: r.id, updatedAt: r.updatedAt, data: r.data })) }, error: null };
    },
  };
  return { client, state, store };
}

async function device(name: string): Promise<AppDB> {
  const d = new AppDB(`sb-${name}-${Math.random()}`);
  await d.open(); await d.setDevicePrefix(name);
  return d;
}
const item = (n: string): Item => ({ id: uuid(), code: '', name: n, brand: '', category: '', unit: 'Pcs', costPaisa: 100, pricePaisa: 150, reorderLevel: 0, discountPct: null } as Item);
const URLX = 'https://abcd1234.supabase.co';
const form = (over: object = {}) => ({ ...EMPTY_SYNC_FORM, kind: 'supabase' as const, url: URLX, key: 'anon-key', email: 'o@x.com', password: 'right', ...over });

describe('sync through Supabase', () => {
  it('two devices share records, and the first device uploads what it already had', async () => {
    const fake = fakeSupabase();
    setSupabaseMaker(async () => fake.client as never);
    const A = await device('A-'); const B = await device('B-');
    const old = await A.put<Item>('items', item('Made before Supabase was connected'));   // saved while no online home was set
    await connectSync(A, form()); await connectSync(B, form());
    expect((await syncNow(A)).ok).toBe(true);       // must send the old record: connecting re-queues everything
    const r = await syncNow(B);
    expect(r.ok).toBe(true);
    expect(await B.items.get(old.id)).toBeTruthy();
    const fromB = await B.put<Item>('items', item('Added on B'));
    await syncNow(B); await syncNow(A);
    expect(await A.items.get(fromB.id)).toBeTruthy();
    expect((await getSyncConfig(A)).kind).toBe('supabase');
  });

  it('a wrong password is refused and does not replace the working setup', async () => {
    const fake = fakeSupabase();
    setSupabaseMaker(async () => fake.client as never);
    const A = await device('A-');
    await expect(connectSync(A, form({ password: 'nope' }))).rejects.toThrow(/Wrong Supabase email or password/);
    expect((await getSyncConfig(A)).key).toBe('');
  });

  it('keeps the saved login when the password box is left empty', async () => {
    const fake = fakeSupabase();
    setSupabaseMaker(async () => fake.client as never);
    const A = await device('A-');
    await connectSync(A, form());
    const cfg = await getSyncConfig(A);
    await expect(connectSync(A, form({ password: '', email: '' }), cfg)).resolves.toBeUndefined();
    await expect(connectSync(A, form({ password: '', email: '' }))).rejects.toThrow(/email and password/);   // no saved login to reuse
  });

  it('says what is wrong instead of failing silently', async () => {
    const notAllowed = fakeSupabase({ signedIn: true, rpcError: { code: '42501', message: 'not allowed' } });
    setSupabaseMaker(async () => notAllowed.client as never);
    const A = await device('A-'); await connectSync(A, form());
    expect((await syncNow(A)).error).toMatch(/not allowed for this shop/);
    const missing = fakeSupabase({ signedIn: true, rpcError: { code: 'PGRST202', message: 'Could not find the function public.sync_exchange' } });
    setSupabaseMaker(async () => missing.client as never);
    expect((await syncNow(A)).error).toMatch(/schema\.sql/);
    const net = fakeSupabase({ signedIn: true, rpcError: { message: 'TypeError: Failed to fetch' } });
    setSupabaseMaker(async () => net.client as never);
    expect((await syncNow(A)).error).toMatch(/Offline/);
    const out = fakeSupabase({ signedIn: false });
    setSupabaseMaker(async () => out.client as never);
    await setSyncConfig(A, { url: URLX, key: 'anon-key', kind: 'supabase' });
    expect((await syncNow(A)).error).toMatch(/Sign in to Supabase again/);
  });

  it('turning sync off signs out; the own-server setting still works as before', async () => {
    const fake = fakeSupabase();
    setSupabaseMaker(async () => fake.client as never);
    const A = await device('A-'); await connectSync(A, form());
    await clearSyncConfig(A);
    expect(fake.state.signOuts).toBe(1);
    expect((await getSyncConfig(A)).key).toBe('');
    await setSyncConfig(A, { url: 'http://x.test/', key: 'k', kind: 'server' });
    expect((await getSyncConfig(A))).toMatchObject({ url: 'http://x.test', kind: 'server' });
    setSupabaseMaker(null);
  });
});
