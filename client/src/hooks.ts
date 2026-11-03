import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './lib/db';
import { allBalances } from './lib/ledger';
import { stockMap } from './lib/stock';
import type { Item, Party, PartyType } from './lib/types';

const EMPTY_ITEMS: Item[] = [];
const EMPTY_PARTIES: Party[] = [];
const EMPTY_MAP = new Map<string, number>();

export function useItems(): Item[] {
  return useLiveQuery(async () => (await db.items.toArray()).filter((i) => !i.deleted).sort((a, b) => a.name.localeCompare(b.name)), [], EMPTY_ITEMS);
}
export function useParties(type?: PartyType): Party[] {
  return useLiveQuery(
    async () => (await db.parties.toArray()).filter((p) => !p.deleted && (!type || p.type === type)).sort((a, b) => a.name.localeCompare(b.name)),
    [type], EMPTY_PARTIES,
  );
}
export function useStock(): Map<string, number> {
  return useLiveQuery(() => stockMap(db), [], EMPTY_MAP);
}
export function useBalances(): Map<string, number> {
  return useLiveQuery(() => allBalances(db), [], EMPTY_MAP);
}
export function usePending(): number {
  return useLiveQuery(() => db.pendingCount(), [], 0);
}
