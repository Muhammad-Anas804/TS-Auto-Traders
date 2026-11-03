import { describe, expect, it } from 'vitest';
import { blankLine, computeLine, computeTotals } from './calc';
import { amountInWords, fmt, parseRupees } from './money';
import type { Line } from './types';

const opts = { roundDiscountToRupee: true };
function line(qty: number, rate: number, o: Partial<Line> = {}): Line {
  return computeLine({ ...blankLine('x'), qty, ratePaisa: rate * 100, discountMode: 'pct', discountPct: 12, ...o }, opts);
}

describe('invoice 5510 from the paper (lines 1-16)', () => {
  // [qty, rate, bonus?, discountPct, expected gross, expected discount, expected net]  (all in rupees)
  const paper: [number, number, boolean, number, number, number, number][] = [
    [1, 525, false, 12, 525, 63, 462],
    [1, 325, false, 12, 325, 39, 286],
    [1, 490, false, 12, 490, 59, 431],
    [20, 185, false, 0, 3700, 0, 3700],
    [5, 185, true, 12, 925, 925, 0],
    [45, 11, false, 12, 495, 59, 436],
    [5, 11, true, 12, 55, 55, 0],
    [2, 1320, false, 12, 2640, 317, 2323],
    [18, 21, false, 12, 378, 45, 333],
    [2, 21, true, 12, 42, 42, 0],
    [2, 1103, false, 12, 2206, 265, 1941],
    [10, 240, false, 0, 2400, 0, 2400],
    [18, 95, false, 12, 1710, 205, 1505],
    [2, 95, true, 12, 190, 190, 0],
    [9, 110, false, 12, 990, 119, 871],
    [1, 110, true, 12, 110, 110, 0],
  ];
  paper.forEach(([qty, rate, bonus, pct, g, d, n], i) => {
    it(`line ${i + 1}: ${qty} x ${rate}${bonus ? ' (free)' : ` @ ${pct}%`}`, () => {
      const l = line(qty, rate, { bonus, discountPct: pct });
      expect([l.grossPaisa, l.discountPaisa, l.netPaisa]).toEqual([g * 100, d * 100, n * 100]);
    });
  });
});

describe('discount modes', () => {
  it('fixed amount discount is capped at the gross', () => {
    expect(line(2, 100, { discountMode: 'amount', discountPaisa: 50000 }).netPaisa).toBe(0);
    expect(line(2, 100, { discountMode: 'amount', discountPaisa: 2500 }).netPaisa).toBe(17500);
  });
  it('keeps paisa when rounding to the rupee is turned off', () => {
    const l = computeLine({ ...blankLine('y'), qty: 1, ratePaisa: 49000, discountPct: 12 }, { roundDiscountToRupee: false });
    expect(l.discountPaisa).toBe(5880);
  });
  it('ignores negative / junk input', () => {
    const l = line(-3, 100);
    expect(l.qty).toBe(0);
    expect(l.netPaisa).toBe(0);
  });
});

describe('totals', () => {
  it('adds lines and applies an extra discount without going below zero', () => {
    const ls = [line(1, 525), line(20, 185, { discountPct: 0 })];
    const t = computeTotals(ls, 10000);
    expect(t.grossPaisa).toBe(422500);
    expect(t.lineDiscountPaisa).toBe(6300);
    expect(t.netPaisa).toBe(422500 - 6300 - 10000);
    expect(computeTotals(ls, 99999999).netPaisa).toBe(0);
  });
});

describe('money', () => {
  it('formats like the paper invoice', () => {
    expect(fmt(370000)).toBe('3,700.00');
    expect(fmt(-12345)).toBe('-123.45');
    expect(fmt(0)).toBe('0.00');
  });
  it('parses user text', () => {
    expect(parseRupees('1,234.5')).toBe(123450);
    expect(parseRupees('')).toBe(0);
    expect(parseRupees('abc')).toBe(0);
    expect(parseRupees(0.1 + 0.2)).toBe(30);
  });
  it('writes amounts in words with lakh/crore', () => {
    expect(amountInWords(194100)).toBe('One Thousand Nine Hundred Forty One Rupees Only');
    expect(amountInWords(123456750)).toBe('Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees and Fifty Paisa Only');
    expect(amountInWords(0)).toBe('Zero Rupees Only');
    expect(amountInWords(25000000000)).toBe('Twenty Five Crore Rupees Only');
  });
});

import { amountInWordsFor, amountInWordsUrdu } from './money';
describe('Urdu amount in words', () => {
  it('writes common invoice totals', () => {
    expect(amountInWordsUrdu(370000)).toBe('تین ہزار سات سو روپے صرف');
    expect(amountInWordsUrdu(46200)).toBe('چار سو باسٹھ روپے صرف');
    expect(amountInWordsUrdu(10000000)).toBe('ایک لاکھ روپے صرف');
    expect(amountInWordsUrdu(123456)).toBe('ایک ہزار دو سو چونتیس روپے اور چھپن پیسے صرف');
    expect(amountInWordsUrdu(0)).toBe('صفر روپے صرف');
    expect(amountInWordsUrdu(-5000)).toBe('منفی پچاس روپے صرف');
  });
  it('covers every number from 0 to 99 without gaps', () => {
    for (let n = 0; n < 100; n++) expect(amountInWordsUrdu(n * 100)).toMatch(/روپے صرف$/);
  });
  it('picks the language for the invoice', () => {
    expect(amountInWordsFor('en', 370000)).toMatch(/^Three Thousand/);
    expect(amountInWordsFor('both', 370000)).toContain(' / ');
  });
});
