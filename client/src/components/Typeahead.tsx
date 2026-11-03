import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Option { key: string; label: ReactNode; meta?: ReactNode }

interface Props {
  value: string;
  onChange: (text: string) => void;
  options: Option[];
  onPick: (key: string) => void;
  addLabel?: string; // shows a "+ add" row at the end
  onAdd?: () => void;
  placeholder?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
  onEnterWhenClosed?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  minListWidth?: number;
}

/**
 * Text box with a suggestion list. The list is drawn in a portal with fixed position so it is
 * never clipped by scrolling tables. Arrow keys move, Enter picks, Esc closes.
 */
export default function Typeahead(p: Props) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLInputElement | null>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const total = p.options.length + (p.onAdd && p.addLabel ? 1 : 0);

  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const width = Math.max(r.width, p.minListWidth ?? 320);
    const left = Math.min(r.left, Math.max(8, window.innerWidth - width - 8));
    setRect({ left, top: r.bottom + 2, width });
  }, [open, p.value, p.minListWidth]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);

  useEffect(() => { setHi(0); }, [p.value]);

  const pick = (i: number) => {
    if (i < p.options.length) p.onPick(p.options[i].key);
    else p.onAdd?.();
    setOpen(false);
  };

  return (
    <>
      <input
        type="text"
        className={p.className}
        ref={(el) => { box.current = el; p.inputRef?.(el); }}
        value={p.value}
        placeholder={p.placeholder}
        disabled={p.disabled}
        autoFocus={p.autoFocus}
        autoComplete="off"
        onChange={(e) => { p.onChange(e.target.value); setOpen(true); }}
        onFocus={(e) => { e.currentTarget.select(); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(total - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Escape') setOpen(false);
          else if (e.key === 'Enter') {
            if (open && total > 0 && p.value.trim() !== '') { e.preventDefault(); pick(hi); }
            else if (p.onEnterWhenClosed) { e.preventDefault(); p.onEnterWhenClosed(); }
          }
        }}
      />
      {open && rect && total > 0 && createPortal(
        <div className="picker-list" style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, right: 'auto', zIndex: 300 }}>
          {p.options.map((o, i) => (
            <div key={o.key} className={`opt ${i === hi ? 'on' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(i); }} onMouseEnter={() => setHi(i)}>
              <span>{o.label}</span><span className="meta">{o.meta}</span>
            </div>
          ))}
          {p.onAdd && p.addLabel && (
            <div className={`opt add ${hi === p.options.length ? 'on' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(p.options.length); }}>
              + {p.addLabel}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/** All words typed must appear somewhere in the haystack (case-insensitive). */
export function matches(hay: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const h = hay.toLowerCase();
  return q.split(/\s+/).every((w) => h.includes(w));
}
