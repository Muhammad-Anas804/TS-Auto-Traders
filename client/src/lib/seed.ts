import type { AppDB } from './db';
import { uuid } from './db';
import type { Item, Party } from './types';
import { adjustStock } from './stock';
import { todayISO } from './money';

/**
 * Items taken from invoice 5510 so a new shop can try the app straight away.
 * Costs are left at 0 (not on the invoice): fill them in to get profit reports.
 */
const SAMPLE_ITEMS: { name: string; brand: string; price: number; unit?: string; discountPct?: number; stock: number }[] = [
  { name: 'Clutch Plate Set CG150', brand: 'SAZ', price: 525, stock: 20 },
  { name: 'Pressure Plate Set CG150', brand: 'SAZ', price: 325, stock: 20 },
  { name: 'Cross (28)', brand: 'SAZ', price: 490, stock: 15 },
  { name: 'Cable Brake', brand: 'SAZ', price: 185, discountPct: 0, stock: 100 },
  { name: 'Valve Seal JH90', brand: 'SAZ', price: 11, stock: 400 },
  { name: 'Connecting Rod Kit (RP150)', brand: 'SAZ', price: 1320, stock: 10 },
  { name: 'Carburator Insulator 70cc', brand: 'SAZ', price: 21, stock: 100 },
  { name: 'Bearing 63/28 Set 1RS', brand: 'SAZ', price: 1103, stock: 10 },
  { name: 'Kick CD70 N/m', brand: 'Master Parts', price: 240, discountPct: 0, stock: 30 },
  { name: 'Sprocket Bolt Kit', brand: 'SAZ', price: 95, stock: 60 },
  { name: 'Tappet Cover Set With O Ring (C)', brand: 'SAZ', price: 110, stock: 50 },
  { name: 'Chain Kit Oditer CG125', brand: 'SAZ', price: 1470, stock: 20 },
  { name: 'Chain Kit CD70 Oditor', brand: 'SAZ', price: 980, stock: 20 },
  { name: 'Clutch Housing Set Only YD100', brand: 'SAZ', price: 950, stock: 10 },
];

export async function loadSampleData(db: AppDB): Promise<number> {
  const existing = new Set((await db.items.toArray()).filter((i) => !i.deleted).map((i) => i.name.toLowerCase()));
  let n = 0;
  await db.atomic(async () => {
    for (const s of SAMPLE_ITEMS) {
      if (existing.has(s.name.toLowerCase())) continue;
      const item = await db.put<Item>('items', {
        id: uuid(), code: '', name: s.name, brand: s.brand, category: 'Motorcycle parts', unit: s.unit ?? 'Pcs',
        costPaisa: 0, pricePaisa: s.price * 100, reorderLevel: 5, discountPct: s.discountPct ?? null,
      });
      await adjustStock(db, item.id, s.stock, todayISO(), 'Sample opening stock', 'opening');
      n++;
    }
    const hasHarris = (await db.parties.toArray()).some((p) => !p.deleted && /harris auto/i.test(p.name));
    if (!hasHarris) {
      await db.put<Party>('parties', {
        id: uuid(), type: 'customer', name: 'Harris Auto Sham Kot.Xii', address: '', phone: '', area: '',
        openingPaisa: 0, creditLimitPaisa: 0, defaultDiscountPct: 12,
      });
    }
  });
  return n;
}
