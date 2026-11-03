import { useSyncExternalStore } from 'react';
import ur from './ur';

/**
 * Two languages: English (the source text) and Urdu.
 *
 * Usage:  t('Save')                        -> 'Save' | 'محفوظ کریں'
 *         t('{n} items', { n: 5 })          -> '5 items' | '5 آئٹم'
 *
 * The English text IS the key. Every key used in the code needs an Urdu entry in src/i18n/ur/*.ts
 * (a test enforces this). A missing Urdu entry falls back to English so the screen never breaks.
 */
export type Lang = 'en' | 'ur';
export type InvoiceLang = 'en' | 'ur' | 'both';

const STORE_KEY = 'ts-lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'en' || saved === 'ur') return saved;
  } catch { /* storage blocked: fall through */ }
  try {
    if (typeof navigator !== 'undefined' && /^ur\b/i.test(navigator.language)) return 'ur';
  } catch { /* ignore */ }
  return 'en';
}

let current: Lang = initial();
const listeners = new Set<() => void>();

function applyToDocument(l: Lang) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.lang = l;
  root.dir = l === 'ur' ? 'rtl' : 'ltr';
}
applyToDocument(current);

export function getLang(): Lang { return current; }
export function isRtl(): boolean { return current === 'ur'; }

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try { localStorage.setItem(STORE_KEY, l); } catch { /* ignore */ }
  applyToDocument(l);
  listeners.forEach((fn) => fn());
}

export function toggleLang(): void { setLang(current === 'ur' ? 'en' : 'ur'); }

/** Re-renders the calling component when the language changes. Call it once near the top of the app. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => current,
    () => current,
  );
}

function fill(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Translate into a specific language (used by the printed invoice, which has its own language setting). */
export function tIn(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const text = lang === 'ur' ? ur[key] ?? key : key;
  return fill(text, params);
}

/** Translate into the language the app is currently showing. */
export function t(key: string, params?: Record<string, string | number>): string {
  return tIn(current, key, params);
}

/** For the printed invoice: 'en', 'ur', or both ("Invoice No. / انوائس نمبر"). */
export function tInvoice(mode: InvoiceLang, key: string, params?: Record<string, string | number>): string {
  if (mode === 'en') return tIn('en', key, params);
  if (mode === 'ur') return tIn('ur', key, params);
  const en = tIn('en', key, params);
  const u = tIn('ur', key, params);
  return en === u ? en : `${en} / ${u}`;
}

export const hasUrdu = (key: string): boolean => key in ur;

/**
 * Marks an English string for translation WITHOUT translating it yet. Use it in lookup tables and constants,
 * then pass the value to t() where it is shown:   const LABEL = { sale: tk('Sale') };  ...  t(LABEL[kind])
 */
export const tk = (s: string): string => s;
