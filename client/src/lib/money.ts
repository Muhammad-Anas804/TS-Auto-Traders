// All money in the app is stored as integer paisa (1 rupee = 100 paisa) to avoid float errors.

export function parseRupees(input: string | number | null | undefined): number {
  if (input === null || input === undefined) return 0;
  if (typeof input === 'number') return Math.round(input * 100);
  const cleaned = String(input).replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function toRupees(paisa: number): number {
  return paisa / 100;
}

/** 123456 -> "1,234.56"; whole numbers keep ".00" so columns align like the paper invoice. */
export function fmt(paisa: number): string {
  const neg = paisa < 0;
  const abs = Math.abs(Math.round(paisa));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${w}.${frac}`;
}

/** Quantity display: 20 -> "20", 2.5 -> "2.5" */
export function fmtQty(q: number): string {
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 1000) / 1000);
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 2026-10-18 -> 18-10-2026 (the format on the paper invoice) */
export function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)], 'Hundred'); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)]); n %= 10; }
  if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

/** 123456 paisa -> "One Thousand Two Hundred Thirty Four Rupees and Fifty Six Paisa Only" (Lakh / Crore grouping). */
export function amountInWords(paisa: number): string {
  const abs = Math.abs(Math.round(paisa));
  let rupees = Math.floor(abs / 100);
  const ps = abs % 100;
  if (rupees === 0 && ps === 0) return 'Zero Rupees Only';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(below1000(crore), 'Crore');
  if (lakh) parts.push(below1000(lakh), 'Lakh');
  if (thousand) parts.push(below1000(thousand), 'Thousand');
  if (rupees) parts.push(below1000(rupees));
  const r = parts.join(' ');
  let out = r ? `${r} Rupees` : '';
  if (ps) out += `${out ? ' and ' : ''}${below1000(ps)} Paisa`;
  return `${paisa < 0 ? 'Minus ' : ''}${out} Only`;
}

// ---- Urdu amount in words ---------------------------------------------------------------
const UR_0_99 = [
  'صفر', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو', 'دس', 'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس',
  'بیس', 'اکیس', 'بائیس', 'تیئیس', 'چوبیس', 'پچیس', 'چھبیس', 'ستائیس', 'اٹھائیس', 'انتیس',
  'تیس', 'اکتیس', 'بتیس', 'تینتیس', 'چونتیس', 'پینتیس', 'چھتیس', 'سینتیس', 'اڑتیس', 'انتالیس',
  'چالیس', 'اکتالیس', 'بیالیس', 'تینتالیس', 'چوالیس', 'پینتالیس', 'چھیالیس', 'سینتالیس', 'اڑتالیس', 'انچاس',
  'پچاس', 'اکیاون', 'باون', 'ترپن', 'چون', 'پچپن', 'چھپن', 'ستاون', 'اٹھاون', 'انسٹھ',
  'ساٹھ', 'اکسٹھ', 'باسٹھ', 'تریسٹھ', 'چونسٹھ', 'پینسٹھ', 'چھیاسٹھ', 'سڑسٹھ', 'اڑسٹھ', 'انہتر',
  'ستر', 'اکہتر', 'بہتر', 'تہتر', 'چوہتر', 'پچھتر', 'چھہتر', 'ستتر', 'اٹھہتر', 'اناسی',
  'اسی', 'اکیاسی', 'بیاسی', 'تراسی', 'چوراسی', 'پچاسی', 'چھیاسی', 'ستاسی', 'اٹھاسی', 'نواسی',
  'نوے', 'اکانوے', 'بانوے', 'ترانوے', 'چورانوے', 'پچانوے', 'چھیانوے', 'ستانوے', 'اٹھانوے', 'ننانوے',
];

function urBelow1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(UR_0_99[Math.floor(n / 100)], 'سو'); n %= 100; }
  if (n > 0) parts.push(UR_0_99[n]);
  return parts.join(' ');
}

/** 370000 paisa -> "تین ہزار سات سو روپے صرف" (Lakh / Crore grouping, like the English version). */
export function amountInWordsUrdu(paisa: number): string {
  const abs = Math.abs(Math.round(paisa));
  let rupees = Math.floor(abs / 100);
  const ps = abs % 100;
  if (rupees === 0 && ps === 0) return 'صفر روپے صرف';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(urBelow1000(crore), 'کروڑ');
  if (lakh) parts.push(urBelow1000(lakh), 'لاکھ');
  if (thousand) parts.push(urBelow1000(thousand), 'ہزار');
  if (rupees) parts.push(urBelow1000(rupees));
  const r = parts.join(' ');
  let out = r ? `${r} روپے` : '';
  if (ps) out += `${out ? ' اور ' : ''}${UR_0_99[ps]} پیسے`;
  return `${paisa < 0 ? 'منفی ' : ''}${out} صرف`;
}

/** Amount in words in the requested invoice language ('both' gives English, then Urdu on a second part). */
export function amountInWordsFor(lang: 'en' | 'ur' | 'both', paisa: number): string {
  if (lang === 'ur') return amountInWordsUrdu(paisa);
  if (lang === 'both') return `${amountInWords(paisa)} / ${amountInWordsUrdu(paisa)}`;
  return amountInWords(paisa);
}
