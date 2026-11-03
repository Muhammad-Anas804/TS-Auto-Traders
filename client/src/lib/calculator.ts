/**
 * Small, safe expression evaluator for the shop calculator (no eval).
 * Supports + - × ÷ (also * and /), parentheses, decimals, unary minus and %.
 * Percent rule (like a shop calculator): "200 + 10%" = 220, "200 - 10%" = 180,
 * "200 × 10%" = 20, and a lone "10%" = 0.1.
 * Returns null when the text is not a complete valid expression.
 */
export function evaluate(text: string): number | null {
  const src = text.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '').replace(/\s+/g, '');
  if (!src) return null;
  let i = 0;
  let bad = false;

  const peek = () => src[i];
  const num = (): number => {
    const m = /^\d*\.?\d+|^\d+\.?/.exec(src.slice(i));
    if (!m) { bad = true; return 0; }
    i += m[0].length;
    return parseFloat(m[0]);
  };

  // factor := number | '(' expr ')' | '-' factor, each optionally followed by %
  const factor = (): { v: number; pct: boolean } => {
    let v: number;
    if (peek() === '-') { i++; const f = factor(); return { v: -f.v, pct: f.pct }; }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') {
      i++;
      v = expr();
      if (peek() === ')') i++; else bad = true;
    } else v = num();
    let pct = false;
    while (peek() === '%') { i++; v /= 100; pct = true; }
    return { v, pct };
  };

  const term = (): { v: number; pct: boolean } => {
    let { v, pct } = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = factor();
      if (op === '*') v *= r.v;
      else { if (r.v === 0) { bad = true; return { v: 0, pct: false }; } v /= r.v; }
      pct = false;
    }
    return { v, pct };
  };

  function expr(): number {
    let { v } = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = term();
      // "a + b%" means a + (b% of a)
      const rhs = r.pct ? v * r.v : r.v;
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }

  const result = expr();
  if (bad || i !== src.length || !Number.isFinite(result)) return null;
  // Remove binary floating point noise (0.1 + 0.2 -> 0.3).
  return Math.round(result * 1e10) / 1e10;
}

/** Shows a result the way the rest of the app does: grouped thousands, up to 4 decimals, no trailing zeros. */
export function formatResult(n: number): string {
  const s = n.toLocaleString('en-US', { maximumFractionDigits: 4, useGrouping: true });
  return s === '-0' ? '0' : s;
}
