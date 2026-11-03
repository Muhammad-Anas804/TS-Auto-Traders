import { useState } from 'react';
import { db, uuid } from '../lib/db';
import { adjustStock } from '../lib/stock';
import { fmt, parseRupees, todayISO } from '../lib/money';
import type { Item } from '../lib/types';
import { useApp } from '../state';
import { Field, Modal } from './ui';
import { t } from '../i18n';

export default function ItemForm({ item, initialName, initialPricePaisa, onClose, onSaved }: {
  item?: Item; initialName?: string; initialPricePaisa?: number; onClose: () => void; onSaved?: (i: Item) => void;
}) {
  const { can, toast } = useApp();
  const showCost = can('cost.view');
  const [f, setF] = useState({
    code: item?.code ?? '',
    name: item?.name ?? initialName ?? '',
    brand: item?.brand ?? '',
    category: item?.category ?? '',
    unit: item?.unit ?? 'Pcs',
    cost: item ? String(item.costPaisa / 100 || '') : '',
    price: item ? String(item.pricePaisa / 100 || '') : initialPricePaisa ? String(initialPricePaisa / 100) : '',
    reorder: String(item?.reorderLevel ?? 0),
    disc: item?.discountPct == null ? '' : String(item.discountPct),
    opening: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!f.name.trim()) { toast(t('Item name is required'), 'err'); return; }
    setSaving(true);
    try {
      const dup = (await db.items.toArray()).find(
        (i) => !i.deleted && i.id !== item?.id && f.code.trim() !== '' && i.code.toLowerCase() === f.code.trim().toLowerCase(),
      );
      if (dup) { toast(t('Code {code} is already used by "{name}"', { code: f.code, name: dup.name }), 'err'); setSaving(false); return; }
      const saved = await db.atomic(async () => {
        const rec = await db.put<Item>('items', {
          id: item?.id ?? uuid(), code: f.code.trim(), name: f.name.trim(), brand: f.brand.trim(), category: f.category.trim(),
          unit: f.unit.trim() || 'Pcs',
          costPaisa: showCost ? parseRupees(f.cost) : item?.costPaisa ?? 0,
          pricePaisa: parseRupees(f.price),
          reorderLevel: Math.max(0, Number(f.reorder) || 0),
          discountPct: f.disc.trim() === '' ? null : Math.min(100, Math.max(0, Number(f.disc) || 0)),
        });
        const open = Number(f.opening);
        if (!item && open) await adjustStock(db, rec.id, open, todayISO(), 'Opening stock', 'opening');
        return rec;
      });
      toast(t('Item saved'), 'ok');
      onSaved?.(saved);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
      setSaving(false);
    }
  };

  return (
    <Modal title={item ? t('Edit item') : t('New item')} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{t('Cancel')}</button>
      <button className="btn primary" onClick={save} disabled={saving}>{t('Save item')}</button>
    </>}>
      <div className="form-grid">
        <Field label={t('Item name *')} className="span2"><input type="text" value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label={t('Code / barcode')} hint={t('Optional. Must be unique.')}><input type="text" value={f.code} onChange={set('code')} /></Field>
        <Field label={t('Brand')}><input type="text" value={f.brand} onChange={set('brand')} placeholder={t('SAZ, Master Parts…')} /></Field>
        <Field label={t('Category')}><input type="text" value={f.category} onChange={set('category')} /></Field>
        <Field label={t('Unit')}><input type="text" value={f.unit} onChange={set('unit')} placeholder={t('Pcs, Set, Box')} /></Field>
        <Field label={t('Sale price (Rs)')}><input type="number" step="any" inputMode="decimal" value={f.price} onChange={set('price')} /></Field>
        {showCost && <Field label={t('Purchase cost (Rs)')} hint={item && item.costPaisa === 0 ? t('Not set: profit reports need it') : undefined}>
          <input type="number" step="any" inputMode="decimal" value={f.cost} onChange={set('cost')} /></Field>}
        <Field label={t('Low-stock alert at')} hint={t('Warn when stock is this or lower')}><input type="number" value={f.reorder} onChange={set('reorder')} /></Field>
        <Field label={t('Usual discount %')} hint={t("Blank = customer's default. 0 = never discount.")}>
          <input type="number" step="any" inputMode="decimal" value={f.disc} onChange={set('disc')} /></Field>
        {!item && <Field label={t('Opening stock')} hint={t('How many you have on the shelf now')}><input type="number" step="any" value={f.opening} onChange={set('opening')} /></Field>}
      </div>
      {item && <p className="hint" style={{ marginBottom: 0 }}>{t('Current sale price: Rs {price}. Past invoices keep the price they were sold at.', { price: fmt(item.pricePaisa) })}</p>}
    </Modal>
  );
}
