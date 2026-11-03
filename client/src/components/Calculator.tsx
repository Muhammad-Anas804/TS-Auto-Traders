import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { evaluate, formatResult } from '../lib/calculator';
import { useToast } from '../state';

interface Props { onClose: () => void }

const KEYS: { label: string; v: string; cls?: string }[][] = [
  [{ label: 'C', v: 'C', cls: 'fn' }, { label: '⌫', v: 'BS', cls: 'fn' }, { label: '%', v: '%', cls: 'fn' }, { label: '÷', v: '÷', cls: 'op' }],
  [{ label: '7', v: '7' }, { label: '8', v: '8' }, { label: '9', v: '9' }, { label: '×', v: '×', cls: 'op' }],
  [{ label: '4', v: '4' }, { label: '5', v: '5' }, { label: '6', v: '6' }, { label: '−', v: '−', cls: 'op' }],
  [{ label: '1', v: '1' }, { label: '2', v: '2' }, { label: '3', v: '3' }, { label: '+', v: '+', cls: 'op' }],
  [{ label: '(', v: '(' }, { label: '0', v: '0' }, { label: '.', v: '.' }, { label: '=', v: '=', cls: 'eq' }],
];

const ALLOWED = /[^0-9+\-−×÷*/().%\s,]/g;

/** A pocket calculator that floats over any screen, so it can be used while an invoice is open. */
export default function Calculator({ onClose }: Props) {
  const toast = useToast();
  const [expr, setExpr] = useState('');
  const [history, setHistory] = useState<{ e: string; r: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const live = evaluate(expr);
  const liveText = live === null ? '' : formatResult(live);

  const equals = () => {
    if (live === null) { if (expr.trim()) toast(t('Check the numbers: the sum is incomplete'), 'err'); return; }
    const r = String(live);
    setHistory((h) => [{ e: expr, r: formatResult(live) }, ...h].slice(0, 6));
    setExpr(r);
  };

  const press = (v: string) => {
    if (v === 'C') setExpr('');
    else if (v === 'BS') setExpr((x) => x.slice(0, -1));
    else if (v === '=') equals();
    else setExpr((x) => x + v);
    input.current?.focus();
  };

  const copy = async () => {
    if (live === null) return;
    try { await navigator.clipboard.writeText(String(live)); toast(t('Copied {n}', { n: formatResult(live) }), 'ok'); }
    catch { toast(t('Could not copy. Select the number and copy it.'), 'err'); }
  };

  return (
    <div className="calc-panel no-print" role="dialog" aria-label={t('Calculator')}>
      <div className="calc-head">
        <b>{t('Calculator')}</b>
        <span className="hint">{t('Esc to close')}</span>
        <button className="btn ghost sm" onClick={onClose} aria-label={t('Close calculator')}>✕</button>
      </div>
      <div className="calc-screen">
        <input
          ref={input} type="text" inputMode="none" value={expr} aria-label={t('Calculation')} autoComplete="off" spellCheck={false}
          placeholder="0"
          onChange={(e) => setExpr(e.target.value.replace(ALLOWED, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); equals(); }
          }}
        />
        <div className="calc-live">{liveText && liveText !== expr ? `= ${liveText}` : ' '}</div>
      </div>
      <div className="calc-keys">
        {KEYS.flat().map((k) => (
          <button key={k.v} className={`ck ${k.cls ?? ''}`} onClick={() => press(k.v)} aria-label={k.v === 'BS' ? t('Backspace') : k.v === 'C' ? t('Clear') : undefined}>{k.label}</button>
        ))}
      </div>
      <div className="calc-foot">
        <button className="btn sm" onClick={copy} disabled={live === null}>{t('Copy result')}</button>
        {history.length > 0 && <button className="btn sm ghost" onClick={() => setHistory([])}>{t('Clear history')}</button>}
      </div>
      {history.length > 0 && (
        <div className="calc-hist">
          {history.map((h, i) => (
            <button key={i} className="hrow" onClick={() => { setExpr(h.e); input.current?.focus(); }} title={t('Use this again')}>
              <span>{h.e}</span><b>{h.r}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
