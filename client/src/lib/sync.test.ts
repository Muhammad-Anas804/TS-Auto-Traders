import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppDB, uuid } from './db';
import { blankLine } from './calc';
import { saveDoc } from './docs';
import { allBalances } from './ledger';
import { adjustStock, stockMap } from './stock';
import { setSyncConfig, syncNow } from './sync';
import type { Item, Party } from './types';

type Server = { close(): void; address(): unknown };
type AddressInfo = { port: number };

// Run the real server (in memory) and two independent "devices" against it.
let server: Server;
let url = '';
const KEY = 'test-sync-key-123';

beforeAll(async () => {
  const modPath = new URL('../../../server/src/app.js', import.meta.url).href;
  const { createApp } = await import(/* @vite-ignore */ modPath);
  const { app } = createApp({ dbFile: ':memory:', syncKey: KEY });
  await new Promise<void>((res) => { server = app.listen(0, '127.0.0.1', () => res()); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

async function device(prefix: string): Promise<AppDB> {
  const d = new AppDB(`dev-${prefix}-${Math.random()}`);
  await d.open();
  await d.setDevicePrefix(prefix);
  await setSyncConfig(d, { url, key: KEY });
  return d;
}
const down: typeof fetch = async () => { throw new TypeError('fetch failed'); };

describe('two devices, one server, flaky internet', () => {
  it('works offline, queues changes, and merges when back online without duplicates', async () => {
    const A = await device('A-');
    const B = await device('B-');

    // Device A sets up items online and shares them.
    const item = await A.put<Item>('items', { id: uuid(), code: '', name: 'Cable Brake', brand: 'SAZ', category: '', unit: 'Pcs', costPaisa: 12000, pricePaisa: 18500, reorderLevel: 0, discountPct: null });
    await adjustStock(A, item.id, 100, '2026-10-01', 'opening', 'opening');
    const cust = await A.put<Party>('parties', { id: uuid(), type: 'customer', name: 'Harris Auto', address: '', phone: '', area: '', openingPaisa: 0, creditLimitPaisa: 0, defaultDiscountPct: 0 });
    expect((await syncNow(A)).ok).toBe(true);
    expect((await syncNow(B)).ok).toBe(true);
    expect(await B.items.get(item.id)).toBeTruthy();

    // Internet drops on both shops. Each keeps selling.
    const sell = (d: AppDB, qty: number) => saveDoc(d, {
      kind: 'sale', date: '2026-10-18', party: cust, poNo: '', poDate: '', challanNo: '', challanDate: '', terms: '', notes: '',
      lines: [{ ...blankLine(uuid()), itemId: item.id, name: item.name, qty, ratePaisa: 18500 }], extraDiscountPaisa: 0, userId: 'u',
    });
    const a1 = await sell(A, 20);
    const b1 = await sell(B, 5);
    expect(a1.no).toBe('A-1');
    expect(b1.no).toBe('B-1'); // never clashes with device A
    const offline = await syncNow(A, down);
    expect(offline.ok).toBe(false);
    expect(offline.error).toMatch(/offline/i);
    expect(await A.pendingCount()).toBeGreaterThan(0); // nothing lost, still queued
    await syncNow(B, down);

    // Back online: both push, both pull. Run twice to prove retries do not duplicate anything.
    for (let i = 0; i < 2; i++) { await syncNow(A); await syncNow(B); await syncNow(A); }
    expect(await A.pendingCount()).toBe(0);
    for (const d of [A, B]) {
      expect((await d.docs.toArray()).filter((x) => x.kind === 'sale')).toHaveLength(2);
      expect((await stockMap(d)).get(item.id)).toBe(100 - 20 - 5); // both sales counted on both devices
      expect((await allBalances(d)).get(cust.id)).toBe(25 * 18500);
    }
  });

  it('a newer edit wins and an old stale copy cannot overwrite it', async () => {
    const A = await device('A-');
    const B = await device('B-');
    const it = await A.put<Item>('items', { id: uuid(), code: '', name: 'Chain Kit', brand: '', category: '', unit: 'Pcs', costPaisa: 0, pricePaisa: 100000, reorderLevel: 0, discountPct: null });
    await syncNow(A); await syncNow(B);
    await A.put<Item>('items', { ...it, pricePaisa: 110000 });
    await new Promise((r) => setTimeout(r, 5));
    await B.put<Item>('items', { ...(await B.items.get(it.id))!, pricePaisa: 120000 }); // later edit on B
    await syncNow(B); await syncNow(A); await syncNow(B);
    expect((await A.items.get(it.id))!.pricePaisa).toBe(120000);
    expect((await B.items.get(it.id))!.pricePaisa).toBe(120000);
  });

  it('rejects a wrong key with a clear message and keeps the queue', async () => {
    const A = await device('A-');
    await A.put<Item>('items', { id: uuid(), code: '', name: 'X', brand: '', category: '', unit: 'Pcs', costPaisa: 0, pricePaisa: 1, reorderLevel: 0, discountPct: null });
    await setSyncConfig(A, { url, key: 'wrong-key-wrong' });
    const r = await syncNow(A);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/key/i);
    expect(await A.pendingCount()).toBe(1);
  });
});
