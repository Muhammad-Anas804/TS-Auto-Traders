import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB, uuid } from './db';
import { blankLine } from './calc';
import { recordPayment, saveDoc, voidDoc, type DocInput } from './docs';
import { allBalances, buildLedger } from './ledger';
import { adjustStock, stockMap } from './stock';
import { cashBook, dailySales, salesByItem } from './reports';
import { can } from './auth';
import type { Item, Line, Party } from './types';

let db: AppDB;
let n = 0;
beforeEach(async () => {
  db = new AppDB(`test-${++n}-${Math.random()}`);
  await db.open();
});

async function mkItem(name: string, price: number, cost = 0, stock = 0, discountPct: number | null = null): Promise<Item> {
  const it = await db.put<Item>('items', { id: uuid(), code: '', name, brand: 'SAZ', category: '', unit: 'Pcs', costPaisa: cost * 100, pricePaisa: price * 100, reorderLevel: 0, discountPct });
  if (stock) await adjustStock(db, it.id, stock, '2026-10-01', 'open', 'opening');
  return it;
}
async function mkParty(name: string, type: 'customer' | 'supplier' = 'customer', opening = 0): Promise<Party> {
  return db.put<Party>('parties', { id: uuid(), type, name, address: 'Sham Kot', phone: '03001234567', area: '', openingPaisa: opening * 100, creditLimitPaisa: 0, defaultDiscountPct: 12 });
}
function ln(item: Item, qty: number, o: Partial<Line> = {}): Line {
  return { ...blankLine(uuid()), itemId: item.id, name: item.name, qty, ratePaisa: item.pricePaisa, costPaisa: item.costPaisa, discountPct: 0, ...o };
}
function input(p: Partial<DocInput> & Pick<DocInput, 'kind' | 'lines'>): DocInput {
  return { date: '2026-10-18', party: null, poNo: '', poDate: '', challanNo: '', challanDate: '', terms: '', notes: '', extraDiscountPaisa: 0, userId: 'u1', ...p };
}

describe('sales, stock and the customer account', () => {
  it('a credit sale lowers stock and raises what the customer owes', async () => {
    const cable = await mkItem('Cable Brake', 185, 120, 100);
    const harris = await mkParty('Harris Auto', 'customer', 1000);
    const doc = await saveDoc(db, input({ kind: 'sale', party: harris, lines: [ln(cable, 20), ln(cable, 5, { bonus: true })] }));
    expect(doc.netPaisa).toBe(370000);
    expect((await stockMap(db)).get(cable.id)).toBe(75); // 5 free pieces still leave the shelf
    const bal = (await allBalances(db)).get(harris.id);
    expect(bal).toBe(100000 + 370000);
  });

  it('cash received with the invoice reduces the balance, and a walk-in sale has no account', async () => {
    const it = await mkItem('Kick', 240, 0, 50);
    const p = await mkParty('Ali');
    await saveDoc(db, input({ kind: 'sale', party: p, lines: [ln(it, 10)], payNowPaisa: 100000 }));
    expect((await allBalances(db)).get(p.id)).toBe(240000 - 100000);
    const walk = await saveDoc(db, input({ kind: 'sale', partyNameOverride: 'Walk-in', lines: [ln(it, 1)], payNowPaisa: 24000 }));
    expect(walk.partyId).toBe('');
    expect((await stockMap(db)).get(it.id)).toBe(39);
  });

  it('editing a sale re-syncs stock instead of double counting', async () => {
    const it = await mkItem('Valve Seal', 11, 0, 500);
    const p = await mkParty('Ali');
    const l = ln(it, 45);
    const doc = await saveDoc(db, input({ kind: 'sale', party: p, lines: [l] }));
    expect((await stockMap(db)).get(it.id)).toBe(455);
    await saveDoc(db, input({ id: doc.id, kind: 'sale', party: p, lines: [{ ...l, qty: 40 }] }));
    expect((await stockMap(db)).get(it.id)).toBe(460);
    await saveDoc(db, input({ id: doc.id, kind: 'sale', party: p, lines: [ln(it, 1)] })); // old line removed entirely
    expect((await stockMap(db)).get(it.id)).toBe(499);
  });

  it('cancelling puts stock and the account back and keeps the record', async () => {
    const it = await mkItem('Chain Kit', 1470, 0, 10);
    const p = await mkParty('Ali');
    const doc = await saveDoc(db, input({ kind: 'sale', party: p, lines: [ln(it, 5)], payNowPaisa: 100000 }));
    await voidDoc(db, doc.id);
    expect((await stockMap(db)).get(it.id)).toBe(10);
    expect((await allBalances(db)).get(p.id)).toBe(0);
    expect((await db.docs.get(doc.id))?.status).toBe('void');
  });

  it('returns and purchases move stock the right way', async () => {
    const it = await mkItem('Bearing', 1103, 900, 10);
    const cust = await mkParty('Ali');
    const sup = await mkParty('Master Parts', 'supplier');
    await saveDoc(db, input({ kind: 'purchase', party: sup, lines: [ln(it, 20, { ratePaisa: 90000 })] }));
    expect((await stockMap(db)).get(it.id)).toBe(30);
    expect((await allBalances(db)).get(sup.id)).toBe(1800000);
    await saveDoc(db, input({ kind: 'sale', party: cust, lines: [ln(it, 4)] }));
    await saveDoc(db, input({ kind: 'sale_return', party: cust, lines: [ln(it, 1)] }));
    expect((await stockMap(db)).get(it.id)).toBe(27);
    expect((await allBalances(db)).get(cust.id)).toBe(3 * 110300);
    await saveDoc(db, input({ kind: 'purchase_return', party: sup, lines: [ln(it, 2, { ratePaisa: 90000 })] }));
    expect((await stockMap(db)).get(it.id)).toBe(25);
    expect((await allBalances(db)).get(sup.id)).toBe(1800000 - 180000);
  });

  it('the ledger running balance matches the totals and orders by date', async () => {
    const it = await mkItem('Cross', 490, 0, 10);
    const p = await mkParty('Ali', 'customer', 500);
    await saveDoc(db, input({ kind: 'sale', party: p, date: '2026-10-10', lines: [ln(it, 1)] }));
    await recordPayment(db, { partyId: p.id, direction: 'in', amountPaisa: 20000, method: 'cash', date: '2026-10-12', userId: 'u1' });
    const rows = await buildLedger(db, p);
    expect(rows.map((r) => r.type)).toEqual(['opening', 'sale', 'payment_in']);
    expect(rows.at(-1)!.balance).toBe(50000 + 49000 - 20000);
    expect((await allBalances(db)).get(p.id)).toBe(rows.at(-1)!.balance);
  });

  it('validation: empty documents, zero qty, missing party', async () => {
    const it = await mkItem('X', 1);
    const sup = await mkParty('S', 'supplier');
    await expect(saveDoc(db, input({ kind: 'sale', partyNameOverride: 'W', lines: [blankLine('a')] }))).rejects.toThrow('at least one');
    await expect(saveDoc(db, input({ kind: 'sale', partyNameOverride: 'W', lines: [ln(it, 0)] }))).rejects.toThrow('quantity');
    await expect(saveDoc(db, input({ kind: 'purchase', party: null, lines: [ln(it, 1)] }))).rejects.toThrow('party');
    await expect(recordPayment(db, { partyId: sup.id, direction: 'out', amountPaisa: 0, method: 'cash', userId: 'u' })).rejects.toThrow();
  });
});

describe('numbering', () => {
  it('counts up per kind, uses the device prefix and skips numbers already taken', async () => {
    await db.setDevicePrefix('B-');
    await db.setCounter('sale', 5511);
    expect(await db.nextDocNo('sale')).toBe('B-5511');
    expect(await db.nextDocNo('sale')).toBe('B-5512');
    expect(await db.nextDocNo('purchase')).toBe('B-PU-1');
    const it = await mkItem('X', 1, 0, 5);
    await saveDoc(db, input({ kind: 'sale', no: 'B-5513', partyNameOverride: 'W', lines: [ln(it, 1)] }));
    expect(await db.nextDocNo('sale')).toBe('B-5514');
  });
});

describe('reports', () => {
  it('daily sales net of returns, item profit with extra discount spread, cash book', async () => {
    const a = await mkItem('A', 100, 60, 100);
    const p = await mkParty('Ali');
    await saveDoc(db, input({ kind: 'sale', party: p, date: '2026-10-18', lines: [ln(a, 10, { discountPct: 10 }), ln(a, 2, { bonus: true })], extraDiscountPaisa: 5000, payNowPaisa: 50000, payMethod: 'bank' }));
    await saveDoc(db, input({ kind: 'sale_return', party: p, date: '2026-10-19', lines: [ln(a, 1)] }));
    const docs = await db.docs.toArray();
    const days = dailySales(docs);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: '2026-10-18', invoices: 1, grossPaisa: 120000, netPaisa: 120000 - 10000 - 20000 - 5000 });
    expect(days[1].returnsPaisa).toBe(10000);
    const [row] = salesByItem(docs);
    // sold 12 pieces (2 free), 1 returned
    expect(row.qty).toBe(11);
    expect(row.freeQty).toBe(2);
    // revenue 90000 - 5000 extra = 85000 minus the 10000 refund; cost 12 x 60 = 720 minus 60 returned
    expect(row.netPaisa).toBe(85000 - 10000);
    expect(row.costPaisa).toBe(72000 - 6000);
    const cb = cashBook(await db.payments.toArray());
    expect(cb[0]).toMatchObject({ date: '2026-10-18', inBank: 50000, inCash: 0 });
  });
});

describe('roles', () => {
  it('only owners see costs and settings; salesmen cannot touch purchases', () => {
    expect(can('owner', 'cost.view')).toBe(true);
    expect(can('salesman', 'cost.view')).toBe(false);
    expect(can('salesman', 'purchases')).toBe(false);
    expect(can('storekeeper', 'sales')).toBe(false);
    expect(can('storekeeper', 'stock.adjust')).toBe(true);
    expect(can(undefined, 'sales')).toBe(false);
  });
});
