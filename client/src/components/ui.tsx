import { t } from '../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label={t('Close')}>✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="page-head no-print"><h1>{title}</h1>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function useConfirm() {
  const [state, setState] = useState<{ msg: string; ok: string; danger: boolean; resolve: (v: boolean) => void } | null>(null);
  const ask = (msg: string, opts: { ok?: string; danger?: boolean } = {}) =>
    new Promise<boolean>((resolve) => setState({ msg, ok: opts.ok ?? t('Yes, continue'), danger: opts.danger ?? false, resolve }));
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  const dialog = state ? (
    <Modal title={t('Please confirm')} onClose={() => close(false)} footer={<>
      <button className="btn" onClick={() => close(false)}>{t('Cancel')}</button>
      <button className={`btn ${state.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>{state.ok}</button>
    </>}>
      <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{state.msg}</p>
    </Modal>
  ) : null;
  return { ask, dialog };
}

/** Search box that waits a moment after typing before filtering big lists. */
export function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

/** Number input that keeps what the user is typing (so "1." and "" are allowed) and reports a parsed number. */
export function NumInput({ value, onChange, step, min, className, placeholder, disabled, onKeyDown, inputRef }: {
  value: number; onChange: (n: number) => void; step?: string; min?: number; className?: string; placeholder?: string; disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const [text, setText] = useState(value === 0 ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) { last.current = value; setText(value === 0 ? '' : String(value)); }
  }, [value]);
  return (
    <input
      ref={inputRef}
      type="number" inputMode="decimal" step={step ?? 'any'} min={min} className={className} placeholder={placeholder ?? '0'} disabled={disabled}
      value={text} onKeyDown={onKeyDown}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.value === '' ? 0 : Number(e.target.value);
        if (Number.isFinite(n)) { last.current = n; onChange(n); }
      }}
    />
  );
}
