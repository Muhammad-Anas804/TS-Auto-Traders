import type { AppDB } from './db';
import { uuid } from './db';
import type { Role, User } from './types';
import { t } from '../i18n';

const ITERATIONS = 150_000;
const SESSION_KEY = 'ts_session';

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function hashPassword(password: string, saltHex: string, iterations = ITERATIONS): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error(t('Secure context required: open the app over HTTPS (or localhost).'));
  }
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256,
  );
  return toHex(bits);
}

export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

export async function createUser(
  db: AppDB, input: { username: string; name: string; password: string; role: Role },
): Promise<User> {
  const username = input.username.trim().toLowerCase();
  if (!username) throw new Error(t('Username is required'));
  if (input.password.length < 4) throw new Error(t('Password must be at least 4 characters'));
  const clash = (await db.users.where('username').equals(username).toArray()).find((u) => !u.deleted);
  if (clash) throw new Error(t('That username is already taken'));
  const salt = newSalt();
  const hash = await hashPassword(input.password, salt);
  return db.put<User>('users', {
    id: uuid(), username, name: input.name.trim() || username, role: input.role,
    salt, hash, iterations: ITERATIONS, active: true,
  });
}

export async function setPassword(db: AppDB, user: User, password: string): Promise<void> {
  if (password.length < 4) throw new Error(t('Password must be at least 4 characters'));
  const salt = newSalt();
  const hash = await hashPassword(password, salt);
  await db.put<User>('users', { ...user, salt, hash, iterations: ITERATIONS });
}

export async function login(db: AppDB, username: string, password: string): Promise<User> {
  const u = (await db.users.where('username').equals(username.trim().toLowerCase()).toArray()).find(
    (x) => !x.deleted && x.active,
  );
  // Always do the hashing work so timing doesn't reveal whether the user exists.
  const hash = await hashPassword(password, u?.salt ?? '00'.repeat(16), u?.iterations ?? ITERATIONS);
  if (!u || hash !== u.hash) throw new Error(t('Wrong username or password'));
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: u.id, at: Date.now() }));
  return u;
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function sessionUserId(): string | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    return s?.userId ?? null;
  } catch {
    return null;
  }
}

export function setSession(userId: string): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, at: Date.now() }));
}

// ---- permissions ----------------------------------------------------------
export type Perm =
  | 'sales' | 'sales.edit' | 'sales.void' | 'purchases' | 'items.edit' | 'cost.view'
  | 'parties.edit' | 'payments' | 'reports' | 'settings' | 'stock.adjust' | 'suppliers';

const MATRIX: Record<Role, Perm[]> = {
  owner: ['sales', 'sales.edit', 'sales.void', 'purchases', 'items.edit', 'cost.view', 'parties.edit', 'payments', 'reports', 'settings', 'stock.adjust', 'suppliers'],
  salesman: ['sales', 'parties.edit', 'payments'],
  storekeeper: ['purchases', 'items.edit', 'stock.adjust', 'suppliers'],
};

export function can(role: Role | undefined, perm: Perm): boolean {
  return !!role && MATRIX[role].includes(perm);
}
