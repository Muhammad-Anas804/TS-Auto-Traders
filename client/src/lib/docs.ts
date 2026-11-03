import type { AppDB } from './db';
import { uuid } from './db';
import { computeLine, computeTotals } from './calc';
import { syncDocMoves } from './stock';
import type { Doc, DocKind, Line, PayMethod, Payment, Party } from './types';
import { todayISO } from './money';
import { t } from '../i18n';

export interface DocInput {
  id?: string;
  kind: DocKind;
  no?: string;
  date: string;
  party: Party | null;
  partyNameOverride?: string; // walk-in customer typed by hand
  poNo: string;
  poDate: string;
  challanNo: string;
  challanDate: string;
  terms: string;
  notes: string;
  lines: Line[];
  extraDiscountPaisa: number;
  /** Money received/paid together with the document (only used when creating). */
  payNowPaisa?: number;
  payMethod?: PayMethod;
  userId: string;
}

export class ValidationError extends Error {}

/**
 * Saves a document (sale, purchase or return) atomically: the document, its stock
 * movements and (optionally) the payment taken at the counter all commit together
 * or not at all, and all of them are queued for sync.
 */
export async function saveDoc(db: AppDB, input: DocInput): Promise<Doc> {
  const shop = await db.getShop();
  const opts = { roundDiscountToRupee: shop.roundDiscountToRupee };
  const lines = input.lines
    .filter((l) => l.name.trim() !== '' || l.itemId)
    .map((l) => computeLine(l, opts));
  if (lines.length === 0) throw new ValidationError(t('Add at least one item'));
  if (lines.some((l) => l.qty <= 0)) throw new ValidationError(t('Every line needs a quantity above zero'));
  const totals = computeTotals(lines, input.extraDiscountPaisa);
  const partyName = input.party?.name ?? input.partyNameOverride?.trim() ?? '';
  if (!input.party && input.kind !== 'sale') throw new ValidationError(t('Choose a party'));
  if (input.kind === 'sale' && !input.party && !partyName) throw new ValidationError(t('Choose a customer or type a walk-in name'));

  return db.atomic(async () => {
    const existing = input.id ? await db.docs.get(input.id) : undefined;
    const no = existing?.no ?? input.no ?? (await db.nextDocNo(input.kind));
    const doc = await db.put<Doc>('docs', {
      id: existing?.id ?? input.id ?? uuid(),
      kind: input.kind,
      no,
      date: input.date,
      partyId: input.party?.id ?? '',
      partyName,
      partyAddress: input.party?.address ?? '',
      partyPhone: input.party?.phone ?? '',
      poNo: input.poNo,
      poDate: input.poDate,
      challanNo: input.challanNo,
      challanDate: input.challanDate,
      terms: input.terms,
      notes: input.notes,
      lines,
      grossPaisa: totals.grossPaisa,
      lineDiscountPaisa: totals.lineDiscountPaisa,
      extraDiscountPaisa: totals.extraDiscountPaisa,
      netPaisa: totals.netPaisa,
      status: existing?.status ?? 'active',
      createdBy: existing?.createdBy ?? input.userId,
      createdAt: existing?.createdAt ?? Date.now(),
    });
    await syncDocMoves(db, doc, existing?.lines ?? []);
    if (!existing && input.payNowPaisa && input.payNowPaisa > 0) {
      const direction = input.kind === 'sale' || input.kind === 'purchase_return' ? 'in' : 'out';
      await db.put<Payment>('payments', {
        id: uuid(), date: input.date, partyId: doc.partyId, direction,
        amountPaisa: Math.min(input.payNowPaisa, doc.netPaisa), method: input.payMethod ?? 'cash',
        ref: '', docId: doc.id, note: `with ${doc.no}`, createdBy: input.userId,
      });
    }
    return doc;
  });
}

/** Voids a document: keeps the record (for audit) but reverses stock and ledger effect. */
export async function voidDoc(db: AppDB, docId: string): Promise<void> {
  await db.atomic(async () => {
    const doc = await db.docs.get(docId);
    if (!doc || doc.status === 'void') return;
    const voided = await db.put<Doc>('docs', { ...doc, status: 'void' });
    await syncDocMoves(db, voided, []);
    const pays = await db.payments.where('docId').equals(docId).toArray();
    for (const p of pays) {
      if (!p.deleted) await db.put<Payment>('payments', { ...p, deleted: true });
    }
  });
}

export async function recordPayment(
  db: AppDB,
  input: {
    partyId: string; direction: 'in' | 'out'; amountPaisa: number; method: PayMethod;
    date?: string; ref?: string; docId?: string | null; note?: string; userId: string;
  },
): Promise<Payment> {
  if (input.amountPaisa <= 0) throw new ValidationError(t('Enter an amount above zero'));
  return db.put<Payment>('payments', {
    id: uuid(), date: input.date ?? todayISO(), partyId: input.partyId, direction: input.direction,
    amountPaisa: input.amountPaisa, method: input.method, ref: input.ref ?? '', docId: input.docId ?? null,
    note: input.note ?? '', createdBy: input.userId,
  });
}
