import Dexie, { type Table } from 'dexie';
import type {
  Base, Doc, DocKind, Item, OutboxEntry, Party, Payment, ShopSettings, StockMove, SyncTable, User,
} from './types';

export interface MetaRow { key: string; value: unknown }

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback for non-secure contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const DEFAULT_SHOP: Omit<ShopSettings, 'updatedAt' | 'deviceId'> = {
  id: 'shop',
  name: 'TS Auto Trader',
  address: '',
  phone: '',
  email: '',
  taxNo: '',
  invoiceTerms: '',
  invoiceFooter: 'Thank you for your business.',
  roundDiscountToRupee: true,
  allowNegativeStock: true,
  defaultDiscountPct: 0,
  invoiceLang: 'en',
};

const KIND_PREFIX: Record<DocKind, string> = {
  sale: '',
  purchase: 'PU-',
  sale_return: 'SR-',
  purchase_return: 'PR-',
};

export class AppDB extends Dexie {
  items!: Table<Item, string>;
  parties!: Table<Party, string>;
  docs!: Table<Doc, string>;
  payments!: Table<Payment, string>;
  stockMoves!: Table<StockMove, string>;
  users!: Table<User, string>;
  settings!: Table<ShopSettings, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaRow, string>;

  /** Stable id of this browser/device. Set when the database opens. */
  devId = '';

  constructor(name = 'ts-auto-trader') {
    super(name);
    this.version(1).stores({
      items: 'id, code, name, brand, category, updatedAt',
      parties: 'id, type, name, phone, updatedAt',
      docs: 'id, [kind+no], kind, date, partyId, status, updatedAt',
      payments: 'id, partyId, date, docId, updatedAt',
      stockMoves: 'id, itemId, refId, date, updatedAt',
      users: 'id, username, updatedAt',
      settings: 'id',
      outbox: '++seq, table, rid',
      meta: 'key',
    });
    this.on('ready', async () => {
      let row = await this.meta.get('deviceId');
      if (!row) {
        row = { key: 'deviceId', value: uuid() };
        await this.meta.put(row);
      }
      this.devId = row.value as string;
    });
  }

  // ---- meta helpers -------------------------------------------------------
  async getMeta<T>(key: string, fallback: T): Promise<T> {
    const r = await this.meta.get(key);
    return r ? (r.value as T) : fallback;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }

  // ---- synced writes ------------------------------------------------------
  /**
   * Writes a record locally and queues it for sync. Everything that should reach
   * other devices goes through here so nothing is ever forgotten in the outbox.
   * Must be called inside a transaction that includes the target table and outbox
   * (or on its own, in which case it opens one).
   */
  async put<T extends Base>(table: SyncTable, rec: Omit<T, 'updatedAt' | 'deviceId'> & Partial<Base>): Promise<T> {
    const tbl = this.table(table) as Table<T, string>;
    const run = async () => {
      const existing = await tbl.get(rec.id);
      const updatedAt = Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
      const full = { ...rec, updatedAt, deviceId: this.devId } as T;
      await tbl.put(full);
      await this.outbox.add({ table, rid: rec.id });
      return full;
    };
    if (Dexie.currentTransaction) return run();
    return this.transaction('rw', [tbl, this.outbox], run);
  }

  async softDelete(table: SyncTable, id: string): Promise<void> {
    const tbl = this.table(table);
    const run = async () => {
      const existing = await tbl.get(id);
      if (!existing) return;
      await this.put(table, { ...existing, deleted: true });
    };
    if (Dexie.currentTransaction) return run();
    return this.transaction('rw', [tbl, this.outbox], run);
  }

  /** Run several synced writes atomically. */
  atomic<T>(fn: () => Promise<T>): Promise<T> {
    return this.transaction('rw', this.tables, fn);
  }

  // ---- shop settings ------------------------------------------------------
  async getShop(): Promise<ShopSettings> {
    const s = await this.settings.get('shop');
    return { ...DEFAULT_SHOP, updatedAt: 0, deviceId: '', ...(s ?? {}) } as ShopSettings;
  }

  // ---- document numbering (per device, so offline devices never clash) ----
  async devicePrefix(): Promise<string> {
    return this.getMeta<string>('numberPrefix', 'A-');
  }

  /** Reserves the next number for a document kind, skipping any already used. */
  async nextDocNo(kind: DocKind): Promise<string> {
    return this.transaction('rw', [this.meta, this.docs], async () => {
      const prefix = (await this.devicePrefix()) + KIND_PREFIX[kind];
      let n = await this.getMeta<number>(`counter:${kind}`, 1);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const no = `${prefix}${n}`;
        const clash = await this.docs.where('[kind+no]').equals([kind, no]).first();
        if (!clash) {
          await this.setMeta(`counter:${kind}`, n + 1);
          return no;
        }
        n++;
      }
    });
  }

  /** Peek without consuming, for display only. */
  async peekDocNo(kind: DocKind): Promise<string> {
    const prefix = (await this.devicePrefix()) + KIND_PREFIX[kind];
    const n = await this.getMeta<number>(`counter:${kind}`, 1);
    return `${prefix}${n}`;
  }

  async getCounter(kind: DocKind): Promise<number> {
    return this.getMeta<number>(`counter:${kind}`, 1);
  }
  async setCounter(kind: DocKind, n: number): Promise<void> {
    await this.setMeta(`counter:${kind}`, Math.max(1, Math.floor(n)));
  }
  async setDevicePrefix(prefix: string): Promise<void> {
    await this.setMeta('numberPrefix', prefix.trim());
  }

  /** Number of local changes not yet sent to the server. */
  async pendingCount(): Promise<number> {
    const rows = await this.outbox.toArray();
    return new Set(rows.map((r) => `${r.table}:${r.rid}`)).size;
  }

  /** Wipes everything on this device (used by "reset this device"). */
  async wipeLocal(): Promise<void> {
    await this.transaction('rw', this.tables, async () => {
      for (const t of this.tables) await t.clear();
    });
  }

  // ---- backup -------------------------------------------------------------
  async exportAll(): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const t of ['items', 'parties', 'docs', 'payments', 'stockMoves', 'users', 'settings'] as SyncTable[]) {
      out[t] = await this.table(t).toArray();
    }
    return out;
  }

  /** Merges a backup file: records are applied if newer than what we have, and queued to sync. */
  async importAll(data: Record<string, Base[]>): Promise<number> {
    let count = 0;
    await this.atomic(async () => {
      for (const t of ['items', 'parties', 'docs', 'payments', 'stockMoves', 'users', 'settings'] as SyncTable[]) {
        for (const rec of data[t] ?? []) {
          const existing = await this.table(t).get(rec.id);
          if (!existing || existing.updatedAt < rec.updatedAt) {
            await this.table(t).put(rec);
            await this.outbox.add({ table: t, rid: rec.id });
            count++;
          }
        }
      }
    });
    return count;
  }
}

export const db = new AppDB();

/** Ask the browser not to evict our data when storage is low. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
