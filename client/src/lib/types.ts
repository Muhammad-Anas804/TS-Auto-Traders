export type Role = 'owner' | 'salesman' | 'storekeeper';

export interface Base {
  id: string;
  updatedAt: number;
  deviceId: string;
  deleted?: boolean;
}

export interface User extends Base {
  username: string;
  name: string;
  role: Role;
  salt: string;
  hash: string;
  iterations: number;
  active: boolean;
}

export interface Item extends Base {
  code: string;
  name: string;
  brand: string;
  category: string;
  unit: string;
  costPaisa: number;
  pricePaisa: number;
  reorderLevel: number;
  /** Usual discount for this item. Blank/null = use the customer's default. 0 = never discount. */
  discountPct?: number | null;
}

export type PartyType = 'customer' | 'supplier';

export interface Party extends Base {
  type: PartyType;
  name: string;
  address: string;
  phone: string;
  area: string;
  openingPaisa: number; // positive = they owe us (customer) / we owe them (supplier)
  creditLimitPaisa: number;
  defaultDiscountPct: number;
}

export type DocKind = 'sale' | 'purchase' | 'sale_return' | 'purchase_return';

export interface Line {
  id: string;
  itemId: string | null;
  name: string;
  unit: string;
  qty: number;
  ratePaisa: number;
  costPaisa: number; // snapshot at time of sale, for profit reports
  discountMode: 'pct' | 'amount';
  discountPct: number;
  discountPaisa: number; // final (computed for pct mode, entered for amount mode)
  bonus: boolean; // free quantity, 100% discount
  grossPaisa: number;
  netPaisa: number;
}

export interface Doc extends Base {
  kind: DocKind;
  no: string;
  date: string; // YYYY-MM-DD
  partyId: string;
  partyName: string;
  partyAddress: string;
  partyPhone: string;
  poNo: string;
  poDate: string;
  challanNo: string;
  challanDate: string;
  terms: string;
  notes: string;
  lines: Line[];
  grossPaisa: number;
  lineDiscountPaisa: number;
  extraDiscountPaisa: number;
  netPaisa: number;
  status: 'active' | 'void';
  createdBy: string;
  createdAt: number;
}

export type PayMethod = 'cash' | 'bank' | 'cheque' | 'online';

export interface Payment extends Base {
  date: string;
  partyId: string;
  direction: 'in' | 'out'; // in = received from customer, out = paid to supplier
  amountPaisa: number;
  method: PayMethod;
  ref: string;
  docId: string | null;
  note: string;
  createdBy: string;
}

export type MoveKind = 'sale' | 'purchase' | 'sale_return' | 'purchase_return' | 'adjust' | 'opening';

export interface StockMove extends Base {
  itemId: string;
  qty: number; // signed: + adds stock, - removes stock
  kind: MoveKind;
  refId: string;
  date: string;
  note: string;
}

export interface ShopSettings extends Base {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxNo: string;
  invoiceTerms: string;
  invoiceFooter: string;
  roundDiscountToRupee: boolean;
  allowNegativeStock: boolean;
  defaultDiscountPct: number;
  /** Language printed on invoices: English, Urdu, or both. Independent of the screen language. */
  invoiceLang?: 'en' | 'ur' | 'both';
}

export type SyncTable = 'items' | 'parties' | 'docs' | 'payments' | 'stockMoves' | 'users' | 'settings';
export const SYNC_TABLES: SyncTable[] = ['items', 'parties', 'docs', 'payments', 'stockMoves', 'users', 'settings'];

export interface OutboxEntry {
  seq?: number;
  table: SyncTable;
  rid: string;
}
