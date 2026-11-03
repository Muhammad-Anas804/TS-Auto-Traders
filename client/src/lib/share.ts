import type { Doc, ShopSettings } from './types';
import { fmt, fmtDate } from './money';
import { t, tIn, tInvoice, tk, type InvoiceLang, type Lang } from '../i18n';

/** 0300-1234567 / +92 300 1234567 / 3001234567 -> 923001234567 (Pakistan). Returns '' if it can't be a number. */
export function waNumber(phone: string): string {
  const d = (phone || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.startsWith('92') && d.length >= 12) return d;
  if (d.startsWith('0')) return '92' + d.slice(1);
  if (d.length === 10) return '92' + d;
  return d;
}

export function waLink(phone: string, text: string): string {
  const n = waNumber(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

const TITLE: Record<Doc['kind'], string> = {
  sale: tk('Sale Invoice'), purchase: tk('Purchase Invoice'), sale_return: tk('Sale Return'), purchase_return: tk('Purchase Return'),
};
/** Document type name in the language of the screen. */
export const docTitle = (k: Doc['kind']) => t(TITLE[k]); // i18n-ok: TITLE values are marked with tk()
/** Document type name for paper / messages: English, Urdu or both. */
export const docTitleFor = (lang: InvoiceLang, k: Doc['kind']) => tInvoice(lang, TITLE[k]); // i18n-ok: TITLE values are marked with tk()

/** Name stored on a sale that has no customer (a cash / walk-in sale). */
export const WALK_IN = 'Walk-in customer';
const isWalkIn = (name: string) => name === WALK_IN || name === 'Walk-in';
/** Party name as shown on screen: the stored walk-in name is shown in the screen language. */
export const partyDisplay = (name: string) => (isWalkIn(name) ? t('Walk-in customer') : name);
/** Party name on paper, in the invoice language. */
export const partyDisplayFor = (lang: InvoiceLang, name: string) => (isWalkIn(name) ? tInvoice(lang, 'Walk-in customer') : name);

export function docMessage(doc: Doc, shop: ShopSettings, balancePaisa?: number): string {
  // The WhatsApp text uses the invoice language; "both" would be too long for a chat, so it uses English.
  const lang: Lang = shop.invoiceLang === 'ur' ? 'ur' : 'en';
  const lines = doc.lines.slice(0, 40).map((l, i) =>
    `${i + 1}. ${l.name} x ${l.qty}${l.bonus ? ` ${tIn(lang, '(free)')}` : ''} = ${fmt(l.netPaisa)}`);
  const more = doc.lines.length > 40 ? `\n${tIn(lang, '...and {n} more lines', { n: doc.lines.length - 40 })}` : '';
  return [
    `*${shop.name}*`,
    `${tIn(lang, TITLE[doc.kind])} #${doc.no}  |  ${fmtDate(doc.date)}`, // i18n-ok: TITLE values are marked with tk()
    doc.partyName ? tIn(lang, 'To: {name}', { name: partyDisplayFor(lang, doc.partyName) }) : '',
    '',
    ...lines,
    more,
    '',
    `*${tIn(lang, 'Net total: Rs {amount}', { amount: fmt(doc.netPaisa) })}*`,
    balancePaisa !== undefined ? tIn(lang, 'Account balance: Rs {amount}', { amount: fmt(balancePaisa) }) : '',
    shop.phone ? tIn(lang, 'Tel: {phone}', { phone: shop.phone }) : '',
    shop.invoiceFooter,
  ].filter((x) => x !== '').join('\n');
}
