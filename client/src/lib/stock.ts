import type { AppDB } from './db';
import { uuid } from './db';
import type { Doc, DocKind, Line, MoveKind, StockMove } from './types';

const SIGN: Record<DocKind, 1 | -1> = {
  sale: -1,
  purchase: 1,
  sale_return: 1,
  purchase_return: -1,
};

/** Current stock for every item: sum of all live stock movements. */
export async function stockMap(db: AppDB): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  // toArray() reads in one bulk request; a cursor ('each') is about 3 times slower on 100k+ rows.
  const moves = await db.stockMoves.toArray();
  for (const m of moves) {
    if (m.deleted) continue;
    map.set(m.itemId, (map.get(m.itemId) ?? 0) + m.qty);
  }
  return map;
}

export async function stockOf(db: AppDB, itemId: string): Promise<number> {
  let total = 0;
  await db.stockMoves.where('itemId').equals(itemId).each((m) => {
    if (!m.deleted) total += m.qty;
  });
  return total;
}

/**
 * Brings the stock movements for a document in line with its current lines.
 * Movement ids are `${docId}:${lineId}` so re-saving a document updates in place
 * (safe to merge across devices) and removed lines or voided documents zero out.
 * Free (bonus) quantity still leaves the shelf, so it counts.
 */
export async function syncDocMoves(db: AppDB, doc: Doc, previousLines: Line[] = []): Promise<void> {
  const sign = SIGN[doc.kind];
  const live = doc.status === 'active';
  const currentIds = new Set<string>();
  for (const l of doc.lines) {
    if (!l.itemId) continue;
    const id = `${doc.id}:${l.id}`;
    currentIds.add(id);
    await db.put<StockMove>('stockMoves', {
      id,
      itemId: l.itemId,
      qty: sign * l.qty,
      kind: doc.kind as MoveKind,
      refId: doc.id,
      date: doc.date,
      note: `${doc.kind} ${doc.no}`,
      deleted: !live,
    });
  }
  for (const l of previousLines) {
    const id = `${doc.id}:${l.id}`;
    if (!l.itemId || currentIds.has(id)) continue;
    const old = await db.stockMoves.get(id);
    if (old && !old.deleted) await db.put<StockMove>('stockMoves', { ...old, deleted: true });
  }
}

export async function adjustStock(
  db: AppDB, itemId: string, qty: number, date: string, note: string, kind: MoveKind = 'adjust',
): Promise<void> {
  if (!qty) return;
  await db.put<StockMove>('stockMoves', { id: uuid(), itemId, qty, kind, refId: '', date, note });
}
