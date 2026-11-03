import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ur from './ur';
import { ALLOWED_TEXT, SKIP_FILES } from './allowed';

const require = createRequire(import.meta.url);
// TypeScript 7 (used for building) has no JavaScript API, so the tests read code with a v5 copy.
const ts = require('typescript-api') as typeof import('typescript-api');

const SRC = path.resolve(__dirname, '..');
const ONLY = (process.env.I18N_FILES ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'i18n') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC)
  .map((p) => ({ abs: p, rel: path.relative(SRC, p).replace(/\\/g, '/') }))
  .filter((f) => !SKIP_FILES.includes(f.rel))
  .filter((f) => ONLY.length === 0 || ONLY.some((o) => f.rel.includes(o)));

const hasWords = (s: string) => /[A-Za-z]{3,}/.test(s);
const looksLikeText = (s: string) => hasWords(s) && (/\s/.test(s.trim()) || /^[A-Z]/.test(s.trim()));
const USER_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'hint', 'addLabel', 'ok', 'text', 'caption', 'description']);
const T_FUNCS = new Set(['t', 'tk']);
// PrintSheet has a tiny local helper L(key) that calls tInvoice(lang, key): treat it like t().
const isKeyFn = (rel: string, name: string) => T_FUNCS.has(name) || (name === 'L' && rel.endsWith('PrintSheet.tsx'));
const USER_CALLS = new Set(['toast', 'ask', 'confirm', 'alert']);

interface Found { keys: { key: string; where: string }[]; problems: string[] }

function scan(rel: string, abs: string): Found {
  const text = fs.readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split('\n');
  const out: Found = { keys: [], problems: [] };
  const pos = (n: import('typescript-api').Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const okLine = (n: import('typescript-api').Node) => /i18n-ok/.test(lines[sf.getLineAndCharacterOfPosition(n.getStart()).line] ?? '');
  const isLit = (n: import('typescript-api').Node): n is import('typescript-api').StringLiteral | import('typescript-api').NoSubstitutionTemplateLiteral =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
  const calleeName = (c: import('typescript-api').CallExpression) => (ts.isIdentifier(c.expression) ? c.expression.text : '');

  const insideTCall = (n: import('typescript-api').Node): boolean => {
    for (let p: import('typescript-api').Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && T_FUNCS.has(calleeName(p))) return true;
      if (ts.isArrowFunction(p) || ts.isFunctionDeclaration(p)) return false;
    }
    return false;
  };

  const visit = (n: import('typescript-api').Node) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      const a0 = n.arguments[0];
      if ((isKeyFn(rel, name) || name === 'tIn' || name === 'tInvoice') && a0 !== undefined) {
        const arg = name === 'tIn' || name === 'tInvoice' ? n.arguments[1] : a0;
        if (arg) {
          if (isLit(arg)) out.keys.push({ key: arg.text, where: pos(arg) });
          else if (!okLine(n)) out.problems.push(`${pos(n)} ${name}() needs a plain string, not an expression. Mark texts with tk('...') and pass the variable to t().`);
        }
      }
      if (USER_CALLS.has(name) && a0 && !okLine(n)) {
        if ((isLit(a0) && hasWords(a0.text) && !ALLOWED_TEXT.has(a0.text)) || ts.isTemplateExpression(a0)) {
          out.problems.push(`${pos(a0)} message shown to the user is not translated: ${a0.getText().slice(0, 70)}`);
        }
      }
    }
    if ((ts.isNewExpression(n)) && n.expression && ts.isIdentifier(n.expression) && /^(ValidationError|Error)$/.test(n.expression.text)) {
      const a0 = n.arguments?.[0];
      if (a0 && !okLine(n) && ((isLit(a0) && hasWords(a0.text)) || ts.isTemplateExpression(a0))) {
        out.problems.push(`${pos(a0)} error message is not translated: ${a0.getText().slice(0, 70)}`);
      }
    }
    if (ts.isJsxText(n)) {
      const s = n.text.replace(/\s+/g, ' ').trim();
      if (s && hasWords(s) && !ALLOWED_TEXT.has(s) && !okLine(n)) out.problems.push(`${pos(n)} untranslated text in JSX: "${s.slice(0, 70)}"`);
    }
    if (ts.isJsxAttribute(n) && n.initializer && USER_ATTRS.has(n.name.getText())) {
      const init = n.initializer;
      const lit = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression && isLit(init.expression) ? init.expression : null;
      if (lit && hasWords(lit.text) && !ALLOWED_TEXT.has(lit.text) && !okLine(n)) out.problems.push(`${pos(n)} untranslated ${n.name.getText()}="${lit.text.slice(0, 60)}"`);
      if (ts.isJsxExpression(init) && init.expression && ts.isTemplateExpression(init.expression) && !okLine(n)) {
        out.problems.push(`${pos(n)} untranslated ${n.name.getText()}={\`...\`}: use t('... {x}', { x })`);
      }
    }
    // string literals directly inside {...} in JSX, e.g. {ok ? 'Yes' : 'No'}
    if (isLit(n) && !okLine(n) && looksLikeText(n.text) && !ALLOWED_TEXT.has(n.text) && !insideTCall(n)) {
      let p: import('typescript-api').Node | undefined = n.parent;
      let inJsxExpr = false, skip = false;
      for (; p; p = p.parent) {
        if (ts.isJsxAttribute(p) && !USER_ATTRS.has(p.name.getText())) { skip = true; break; }
        if (ts.isJsxExpression(p)) { inJsxExpr = !ts.isJsxAttribute(p.parent) || USER_ATTRS.has((p.parent as import('typescript-api').JsxAttribute).name.getText()); break; }
        if (ts.isCallExpression(p) || ts.isBinaryExpression(p) && /[=!]==?/.test(p.operatorToken.getText()) || ts.isCaseClause(p) || ts.isElementAccessExpression(p) || ts.isArrowFunction(p) || ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p)) { skip = true; break; }
      }
      if (inJsxExpr && !skip && !(n.parent && ts.isJsxAttribute(n.parent))) out.problems.push(`${pos(n)} untranslated text in JSX expression: "${n.text.slice(0, 60)}"`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const results = files.map((f) => ({ f, r: scan(f.rel, f.abs) }));

describe('translations', () => {
  it('has Urdu for every t() key used in the code', () => {
    const missing: string[] = [];
    for (const { r } of results) for (const k of r.keys) if (!(k.key in ur)) missing.push(`${k.where}  ${JSON.stringify(k.key)}`);
    expect(missing, `Missing Urdu for ${missing.length} text(s):\n` + missing.slice(0, 60).join('\n')).toEqual([]);
  });

  it('keeps {placeholders} identical in English and Urdu', () => {
    const bad: string[] = [];
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const [k, v] of Object.entries(ur)) if (ph(k) !== ph(v)) bad.push(`${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
    expect(bad).toEqual([]);
  });

  it('writes real Urdu (Arabic script) in every translation', () => {
    const bad = Object.entries(ur).filter(([k, v]) => !v.trim() || (hasWords(k) && !/[؀-ۿ]/.test(v) && !ALLOWED_TEXT.has(k))).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('has no unused or empty Urdu entries when checking the whole app', () => {
    if (ONLY.length) return; // only meaningful on a full run
    const used = new Set(results.flatMap(({ r }) => r.keys.map((k) => k.key)));
    const unused = Object.keys(ur).filter((k) => !used.has(k));
    expect(unused.slice(0, 40), `${unused.length} Urdu entries are not used by any t()/tk()`).toEqual([]);
  });

  it('has no untranslated English left in screens, messages or errors', () => {
    const problems = results.flatMap(({ r }) => r.problems);
    expect(problems, `${problems.length} untranslated place(s):\n` + problems.slice(0, 80).join('\n')).toEqual([]);
  });
});

describe('dictionary groups agree', () => {
  it('does not translate the same English text two different ways', async () => {
    const groups = {
      shell: (await import('./ur/shell')).default, docs: (await import('./ur/docs')).default, parties: (await import('./ur/parties')).default,
      reports: (await import('./ur/reports')).default, settings: (await import('./ur/settings')).default,
    };
    const seen = new Map<string, { g: string; v: string }>(); const clashes: string[] = [];
    for (const [g, d] of Object.entries(groups)) for (const [k, v] of Object.entries(d)) {
      const prev = seen.get(k);
      if (prev && prev.v !== v) clashes.push(`${JSON.stringify(k)}: ${prev.g}="${prev.v}" vs ${g}="${v}"`);
      else seen.set(k, { g, v });
    }
    expect(clashes).toEqual([]);
  });
});
