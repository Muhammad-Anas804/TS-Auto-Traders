import type { Line } from './types';

export interface CalcOptions {
  /** The paper invoice rounds each discount to a whole rupee (e.g. 12% of 490 = 58.80 -> 59). */
  roundDiscountToRupee: boolean;
}

export function blankLine(id: string): Line {
  return {
    id,
    itemId: null,
    name: '',
    unit: 'Pcs',
    qty: 1,
    ratePaisa: 0,
    costPaisa: 0,
    discountMode: 'pct',
    discountPct: 0,
    discountPaisa: 0,
    bonus: false,
    grossPaisa: 0,
    netPaisa: 0,
  };
}

/** Recomputes gross / discount / net for one line. Pure: returns a new object. */
export function computeLine(l: Line, opts: CalcOptions): Line {
  const qty = Number.isFinite(l.qty) && l.qty > 0 ? l.qty : 0;
  const rate = Math.max(0, Math.round(l.ratePaisa || 0));
  const gross = Math.round(qty * rate);
  let discount: number;
  if (l.bonus) {
    discount = gross; // free quantity: 100% discount, like lines 5, 7, 10 on the sample invoice
  } else if (l.discountMode === 'amount') {
    discount = Math.min(Math.max(0, Math.round(l.discountPaisa || 0)), gross);
  } else {
    const pct = Math.min(100, Math.max(0, l.discountPct || 0));
    discount = Math.round((gross * pct) / 100);
    if (opts.roundDiscountToRupee) discount = Math.round(discount / 100) * 100;
    discount = Math.min(discount, gross);
  }
  return { ...l, qty, ratePaisa: rate, grossPaisa: gross, discountPaisa: discount, netPaisa: gross - discount };
}

export interface DocTotals {
  grossPaisa: number;
  lineDiscountPaisa: number;
  extraDiscountPaisa: number;
  netPaisa: number;
  totalQty: number;
}

export function computeTotals(lines: Line[], extraDiscountPaisa: number): DocTotals {
  const gross = lines.reduce((s, l) => s + l.grossPaisa, 0);
  const lineDisc = lines.reduce((s, l) => s + l.discountPaisa, 0);
  const extra = Math.min(Math.max(0, Math.round(extraDiscountPaisa || 0)), gross - lineDisc);
  return {
    grossPaisa: gross,
    lineDiscountPaisa: lineDisc,
    extraDiscountPaisa: extra,
    netPaisa: gross - lineDisc - extra,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
  };
}
