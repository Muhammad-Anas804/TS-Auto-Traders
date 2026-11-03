import type { Doc, Item, Payment } from './types';

/** Sales-side documents with the sign they carry in sales totals. */
function salesSign(d: Doc): 1 | -1 | 0 {
  if (d.deleted || d.status !== 'active') return 0;
  if (d.kind === 'sale') return 1;
  if (d.kind === 'sale_return') return -1;
  return 0;
}

export interface DayRow { date: string; invoices: number; grossPaisa: number; discountPaisa: number; netPaisa: number; returnsPaisa: number }

/** Sales per day (returns are subtracted from the day they were made). */
export function dailySales(docs: Doc[]): DayRow[] {
  const map = new Map<string, DayRow>();
  for (const d of docs) {
    const s = salesSign(d);
    if (!s) continue;
    const r = map.get(d.date) ?? { date: d.date, invoices: 0, grossPaisa: 0, discountPaisa: 0, netPaisa: 0, returnsPaisa: 0 };
    if (s === 1) {
      r.invoices += 1; r.grossPaisa += d.grossPaisa; r.discountPaisa += d.lineDiscountPaisa + d.extraDiscountPaisa; r.netPaisa += d.netPaisa;
    } else r.returnsPaisa += d.netPaisa;
    map.set(d.date, r);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface ItemSalesRow {
  key: string; name: string; qty: number; freeQty: number; netPaisa: number; costPaisa: number; profitPaisa: number;
}

/**
 * Sales by item, with profit. Returns reduce quantity, revenue and cost.
 * Invoice-level (extra) discount is spread across lines in proportion to their net so profit still adds up.
 */
export function salesByItem(docs: Doc[]): ItemSalesRow[] {
  const map = new Map<string, ItemSalesRow>();
  for (const d of docs) {
    const s = salesSign(d);
    if (!s) continue;
    const lineNetTotal = d.lines.reduce((t, l) => t + l.netPaisa, 0);
    for (const l of d.lines) {
      const key = l.itemId ?? `free:${l.name.toLowerCase()}`;
      const r = map.get(key) ?? { key, name: l.name, qty: 0, freeQty: 0, netPaisa: 0, costPaisa: 0, profitPaisa: 0 };
      const share = lineNetTotal > 0 ? Math.round((d.extraDiscountPaisa * l.netPaisa) / lineNetTotal) : 0;
      const net = l.netPaisa - share;
      const cost = Math.round(l.qty * l.costPaisa);
      r.qty += s * l.qty;
      if (l.bonus) r.freeQty += s * l.qty;
      r.netPaisa += s * net;
      r.costPaisa += s * cost;
      r.profitPaisa += s * (net - cost);
      map.set(key, r);
    }
  }
  return [...map.values()].sort((a, b) => b.netPaisa - a.netPaisa);
}

export interface StockRow { item: Item; stock: number; costValue: number; saleValue: number; low: boolean }

export function stockReport(items: Item[], stock: Map<string, number>): StockRow[] {
  return items.filter((i) => !i.deleted).map((item) => {
    const s = stock.get(item.id) ?? 0;
    return {
      item, stock: s,
      costValue: Math.round(Math.max(0, s) * item.costPaisa),
      saleValue: Math.round(Math.max(0, s) * item.pricePaisa),
      low: item.reorderLevel > 0 && s <= item.reorderLevel,
    };
  });
}

export interface CashRow { date: string; inCash: number; inBank: number; outCash: number; outBank: number }

/** Money in/out per day, split between cash and everything else (bank, cheque, online). */
export function cashBook(pays: Payment[]): CashRow[] {
  const map = new Map<string, CashRow>();
  for (const p of pays) {
    if (p.deleted) continue;
    const r = map.get(p.date) ?? { date: p.date, inCash: 0, inBank: 0, outCash: 0, outBank: 0 };
    const cash = p.method === 'cash';
    if (p.direction === 'in') { if (cash) r.inCash += p.amountPaisa; else r.inBank += p.amountPaisa; }
    else if (cash) r.outCash += p.amountPaisa; else r.outBank += p.amountPaisa;
    map.set(p.date, r);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
