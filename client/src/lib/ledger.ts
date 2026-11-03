import type { AppDB } from './db';
import type { Doc, Party, PayMethod, Payment } from './types';

export interface LedgerRow {
  date: string;
  sortKey: number;
  type: 'opening' | 'sale' | 'purchase' | 'sale_return' | 'purchase_return' | 'payment_in' | 'payment_out';
  ref: string;
  /** Payment rows only: how it was paid. The page turns type/ref/method/note into words with t(), so it follows the language. */
  method?: PayMethod;
  note: string;
  debit: number;  // increases the balance
  credit: number; // reduces the balance
  balance: number; // running
}

/**
 * Customer balance (positive = customer owes us):
 *   opening + sales - sale returns - payments received
 * Supplier balance (positive = we owe supplier):
 *   opening + purchases - purchase returns - payments made
 */
export async function buildLedger(db: AppDB, party: Party): Promise<LedgerRow[]> {
  const isCustomer = party.type === 'customer';
  const docs: Doc[] = (await db.docs.where('partyId').equals(party.id).toArray()).filter(
    (d) => !d.deleted && d.status === 'active',
  );
  const pays: Payment[] = (await db.payments.where('partyId').equals(party.id).toArray()).filter((p) => !p.deleted);

  const rows: Omit<LedgerRow, 'balance'>[] = [];
  if (party.openingPaisa) {
    rows.push({
      date: '0000-00-00', sortKey: 0, type: 'opening', ref: '', note: '',
      debit: party.openingPaisa > 0 ? party.openingPaisa : 0,
      credit: party.openingPaisa < 0 ? -party.openingPaisa : 0,
    });
  }
  for (const d of docs) {
    const raises = isCustomer ? d.kind === 'sale' : d.kind === 'purchase';
    const lowers = isCustomer ? d.kind === 'sale_return' : d.kind === 'purchase_return';
    if (!raises && !lowers) continue;
    rows.push({
      date: d.date, sortKey: d.createdAt, type: d.kind, ref: d.no,
      note: '',
      debit: raises ? d.netPaisa : 0,
      credit: lowers ? d.netPaisa : 0,
    });
  }
  for (const p of pays) {
    rows.push({
      date: p.date, sortKey: p.updatedAt, type: p.direction === 'in' ? 'payment_in' : 'payment_out',
      ref: p.ref, method: p.method, note: p.note,
      debit: 0, credit: p.amountPaisa,
    });
  }
  rows.sort((a, b) => (a.date === b.date ? a.sortKey - b.sortKey : a.date < b.date ? -1 : 1));
  let bal = 0;
  return rows.map((r) => {
    bal += r.debit - r.credit;
    return { ...r, balance: bal };
  });
}

export async function partyBalance(db: AppDB, party: Party): Promise<number> {
  const rows = await buildLedger(db, party);
  return rows.length ? rows[rows.length - 1].balance : 0;
}

/** Balances for every party in one pass (used by lists and reports). */
export async function allBalances(db: AppDB): Promise<Map<string, number>> {
  const parties = (await db.parties.toArray()).filter((p) => !p.deleted);
  const out = new Map<string, number>();
  const byParty = new Map<string, number>();
  for (const p of parties) byParty.set(p.id, p.openingPaisa || 0);
  const customers = new Set(parties.filter((p) => p.type === 'customer').map((p) => p.id));
  const allDocs = await db.docs.toArray(); // bulk read, faster than a cursor
  for (const d of allDocs) {
    if (d.deleted || d.status !== 'active' || !byParty.has(d.partyId)) continue;
    const isCust = customers.has(d.partyId);
    const raises = isCust ? d.kind === 'sale' : d.kind === 'purchase';
    const lowers = isCust ? d.kind === 'sale_return' : d.kind === 'purchase_return';
    if (raises) byParty.set(d.partyId, byParty.get(d.partyId)! + d.netPaisa);
    else if (lowers) byParty.set(d.partyId, byParty.get(d.partyId)! - d.netPaisa);
  }
  for (const p of await db.payments.toArray()) {
    if (p.deleted || !byParty.has(p.partyId)) continue;
    byParty.set(p.partyId, byParty.get(p.partyId)! - p.amountPaisa);
  }
  for (const [k, v] of byParty) out.set(k, v);
  return out;
}

/** Total paid against one document. */
export async function paidForDoc(db: AppDB, docId: string): Promise<number> {
  let total = 0;
  await db.payments.where('docId').equals(docId).each((p) => {
    if (!p.deleted) total += p.amountPaisa;
  });
  return total;
}
