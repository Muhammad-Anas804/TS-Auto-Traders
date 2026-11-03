import { useEffect, useState } from 'react';
import type { Party } from '../lib/types';
import { fmt } from '../lib/money';
import { t } from '../i18n';
import Typeahead, { matches } from './Typeahead';

export default function PartyPicker({ parties, value, onPick, onText, balances, placeholder, onAdd, autoFocus, textValue }: {
  parties: Party[]; value: Party | null; onPick: (p: Party | null) => void; onText?: (t: string) => void;
  balances?: Map<string, number>; placeholder?: string; onAdd?: (typed: string) => void; autoFocus?: boolean; textValue?: string;
}) {
  const [text, setText] = useState(value?.name ?? textValue ?? '');
  useEffect(() => { setText(value?.name ?? textValue ?? ''); }, [value?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = parties
    .filter((p) => matches(`${p.name} ${p.phone} ${p.area}`, text))
    .slice(0, 30)
    .map((p) => ({
      key: p.id,
      label: <span><b>{p.name}</b>{p.area ? <span className="muted"> · {p.area}</span> : null}</span>,
      meta: balances ? `Rs ${fmt(balances.get(p.id) ?? 0)}` : p.phone,
    }));
  return (
    <Typeahead
      value={text}
      placeholder={placeholder ?? t('Type a name or phone…')}
      autoFocus={autoFocus}
      options={opts}
      onChange={(t) => { setText(t); if (value && t !== value.name) onPick(null); onText?.(t); }}
      onPick={(id) => { const p = parties.find((x) => x.id === id); if (p) { setText(p.name); onPick(p); } }}
      addLabel={onAdd && text.trim() ? t('Add "{name}" as new', { name: text.trim() }) : undefined}
      onAdd={onAdd ? () => onAdd(text.trim()) : undefined}
    />
  );
}
