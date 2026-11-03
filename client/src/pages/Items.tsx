import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uuid } from '../lib/db';
import { adjustStock } from '../lib/stock';
import { download, parseCSV, toCSV } from '../lib/csv';
import { fmt, fmtDate, fmtQty, parseRupees, todayISO } from '../lib/money';
import type { Item } from '../lib/types';
import { useItems, useStock } from '../hooks';
import { useApp } from '../state';
import { Empty, Field, Modal, PageHead, useConfirm, useDebounced } from '../components/ui';
import { matches } from '../components/Typeahead';
import { t, tk } from '../i18n';
import ItemForm from '../components/ItemForm';

export default function Items() {
  const { can, toast } = useApp();
  const items = useItems();
  const stock = useStock();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [limit, setLimit] = useState(150);
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [adjust, setAdjust] = useState<Item | null>(null);
  const [history, setHistory] = useState<Item | null>(null);
  const [importing, setImporting] = useState(false);
  const { ask, dialog } = useConfirm();
  const showCost = can('cost.view');
  const canEdit = can('items.edit');

  const rows = useMemo(() => items.filter((i) => {
    const s = stock.get(i.id) ?? 0;
    if (filter === 'out' && s > 0) return false;
    if (filter === 'low' && !(i.reorderLevel > 0 && s <= i.reorderLevel)) return false;
    return matches(`${i.name} ${i.code} ${i.brand} ${i.category}`, dq);
  }), [items, stock, dq, filter]);

  const lowCount = items.filter((i) => i.reorderLevel > 0 && (stock.get(i.id) ?? 0) <= i.reorderLevel).length;
  const totalValue = items.reduce((t, i) => t + Math.max(0, stock.get(i.id) ?? 0) * (showCost ? i.costPaisa : i.pricePaisa), 0);

  const remove = async (i: Item) => {
    const s = stock.get(i.id) ?? 0;
    const msg = s ? t('Delete "{name}"?\n\nIt still has {qty} in stock. Old invoices keep their lines.', { name: i.name, qty: fmtQty(s) }) : t('Delete "{name}"?', { name: i.name });
    if (await ask(msg, { ok: t('Delete'), danger: true })) {
      await db.softDelete('items', i.id);
      toast(t('Item deleted'));
    }
  };

  const exportCsv = () => {
    const head = ['code', 'name', 'brand', 'category', 'unit', ...(showCost ? ['cost'] : []), 'price', 'reorder', 'discount', 'stock'];
    const body = items.map((i) => [i.code, i.name, i.brand, i.category, i.unit, ...(showCost ? [i.costPaisa / 100] : []), i.pricePaisa / 100, i.reorderLevel, i.discountPct ?? '', stock.get(i.id) ?? 0]);
    download(`items-${todayISO()}.csv`, toCSV([head, ...body]));
  };

  return (
    <>
      <PageHead title={t('Items & stock')}>
        {canEdit && <>
          <button className="btn" onClick={() => setImporting(true)}>{t('Import CSV')}</button>
        </>}
        <button className="btn" onClick={exportCsv}>{t('Export CSV')}</button>
        {canEdit && <button className="btn primary" onClick={() => setEdit('new')}>{t('+ New item')}</button>}
      </PageHead>
      <div className="stats">
        <div className="stat"><div className="label">{t('Items')}</div><div className="value">{items.length}</div></div>
        <div className="stat"><div className="label">{t('Low or out of stock')}</div><div className="value" style={{ color: lowCount ? 'var(--bad)' : undefined }}>{lowCount}</div></div>
        <div className="stat"><div className="label">{showCost ? t('Stock value (at cost)') : t('Stock value (at sale price)')}</div><div className="value">Rs {fmt(totalValue)}</div></div>
      </div>
      <div className="card flush">
        <div className="toolbar">
          <input className="search" type="search" placeholder={t('Search name, code, brand…')} value={q} onChange={(e) => { setQ(e.target.value); setLimit(150); }} />
          <select aria-label={t('Show items')} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ width: 'auto' }}>
            <option value="all">{t('All items')}</option><option value="low">{t('Low stock')}</option><option value="out">{t('Out of stock')}</option>
          </select>
        </div>
        {rows.length === 0 ? <Empty>{items.length === 0 ? t('No items yet. Add your first item or import a CSV list.') : t('Nothing matches.')}</Empty> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>{t('Item')}</th><th>{t('Brand')}</th><th className="num">{t('Stock')}</th>{showCost && <th className="num">{t('Cost')}</th>}<th className="num">{t('Price')}</th><th className="num">{t('Disc %')}</th><th><span className="sr-only">{t('Actions')}</span></th>
              </tr></thead>
              <tbody>
                {rows.slice(0, limit).map((i) => {
                  const s = stock.get(i.id) ?? 0;
                  const low = i.reorderLevel > 0 && s <= i.reorderLevel;
                  return (
                    <tr key={i.id}>
                      <td><b>{i.name}</b>{i.code && <span className="muted small"> · {i.code}</span>}</td>
                      <td>{i.brand}</td>
                      <td className="num"><span className={`badge ${s <= 0 ? 'bad' : low ? 'warn' : 'ok'}`}>{fmtQty(s)} {i.unit}</span></td>
                      {showCost && <td className="num">{i.costPaisa ? fmt(i.costPaisa) : <span className="muted">{t('not set')}</span>}</td>}
                      <td className="num">{fmt(i.pricePaisa)}</td>
                      <td className="num">{i.discountPct == null ? <span className="muted">{t('default')}</span> : i.discountPct}</td>
                      <td className="num">
                        <button className="btn sm ghost" onClick={() => setHistory(i)}>{t('History')}</button>
                        {can('stock.adjust') && <button className="btn sm" onClick={() => setAdjust(i)}>{t('Stock')}</button>}{' '}
                        {canEdit && <><button className="btn sm" onClick={() => setEdit(i)}>{t('Edit')}</button>{' '}<button className="btn sm danger" onClick={() => remove(i)}>{t('Delete')}</button></>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > limit && <div className="center" style={{ padding: 12 }}><button className="btn" onClick={() => setLimit(limit + 200)}>{t('Show more ({n} left)', { n: rows.length - limit })}</button></div>}
          </div>
        )}
      </div>
      {edit && <ItemForm item={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {adjust && <AdjustModal item={adjust} current={stock.get(adjust.id) ?? 0} onClose={() => setAdjust(null)} />}
      {history && <HistoryModal item={history} onClose={() => setHistory(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {dialog}
    </>
  );
}

// Notes the app writes into stock history itself. They are stored in English and translated when shown.
const STORED_NOTES = [tk('Stock count'), tk('Manual adjustment'), tk('Opening stock'), tk('Opening stock (import)'), tk('Sample opening stock')];
const MOVE_LABEL: Record<string, string> = {
  sale: tk('Sale'), purchase: tk('Purchase'), sale_return: tk('Sale return'), purchase_return: tk('Purchase return'),
  adjust: tk('Stock adjustment'), opening: tk('Opening stock'),
};
function moveText(m: { kind: string; note: string }): string {
  const hit = /^(sale|purchase|sale_return|purchase_return) (.+)$/.exec(m.note);
  if (hit) {
    const no = hit[2];
    if (hit[1] === 'sale') return t('Sale {no}', { no });
    if (hit[1] === 'purchase') return t('Purchase {no}', { no });
    if (hit[1] === 'sale_return') return t('Sale return {no}', { no });
    return t('Purchase return {no}', { no });
  }
  if (!m.note) return t(MOVE_LABEL[m.kind] ?? 'Stock adjustment'); // i18n-ok
  return STORED_NOTES.includes(m.note) ? t(m.note) : m.note; // i18n-ok
}

function AdjustModal({ item, current, onClose }: { item: Item; current: number; onClose: () => void }) {
  const { toast } = useApp();
  const [mode, setMode] = useState<'add' | 'remove' | 'set'>('set');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const n = Number(qty);
  const delta = mode === 'add' ? n : mode === 'remove' ? -n : n - current;
  const save = async () => {
    if (qty === '' || !Number.isFinite(n) || n < 0) { toast(t('Enter a quantity'), 'err'); return; }
    if (delta === 0) { toast(t('Nothing to change')); onClose(); return; }
    await adjustStock(db, item.id, delta, todayISO(), note.trim() || (mode === 'set' ? 'Stock count' : 'Manual adjustment'));
    toast(t('Stock updated'), 'ok');
    onClose();
  };
  return (
    <Modal title={t('Adjust stock: {name}', { name: item.name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save}>{t('Save')}</button></>}>
      <p className="mt" style={{ marginTop: 0 }}>{t('Now in stock:')} <b>{fmtQty(current)} {item.unit}</b></p>
      <div className="form-grid">
        <Field label={t('What happened')}>
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="set">{t('I counted the shelf: set to…')}</option>
            <option value="add">{t('Add stock (found / received)')}</option>
            <option value="remove">{t('Remove stock (damaged / lost)')}</option>
          </select>
        </Field>
        <Field label={mode === 'set' ? t('Counted quantity') : t('Quantity')}><input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
        <Field label={t('Note')} className="span2"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Optional reason')} /></Field>
      </div>
      {qty !== '' && Number.isFinite(n) && <p className="hint">{t('Result:')} {fmtQty(current)} → <b>{fmtQty(current + delta)}</b> ({delta >= 0 ? '+' : ''}{fmtQty(delta)})</p>}
    </Modal>
  );
}

function HistoryModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const moves = useLiveQuery(async () => {
    const m = (await db.stockMoves.where('itemId').equals(item.id).toArray()).filter((x) => !x.deleted);
    return m.sort((a, b) => (a.date === b.date ? a.updatedAt - b.updatedAt : a.date < b.date ? -1 : 1));
  }, [item.id], []);
  let run = 0;
  const rows = moves.map((m) => ({ ...m, bal: (run += m.qty) }));
  return (
    <Modal wide title={t('Stock history: {name}', { name: item.name })} onClose={onClose} footer={<button className="btn" onClick={onClose}>{t('Close')}</button>}>
      {rows.length === 0 ? <Empty>{t('No movements yet.')}</Empty> : (
        <div className="table-wrap" style={{ maxHeight: '60vh' }}>
          <table className="data"><thead><tr><th>{t('Date')}</th><th>{t('What')}</th><th className="num">{t('In / out')}</th><th className="num">{t('Balance')}</th></tr></thead>
            <tbody>{[...rows].reverse().map((m) => (
              <tr key={m.id}><td>{fmtDate(m.date)}</td><td>{moveText(m)}</td>
                <td className={`num ${m.qty < 0 ? 'neg' : 'pos'}`}>{m.qty > 0 ? '+' : ''}{fmtQty(m.qty)}</td><td className="num">{fmtQty(m.bal)}</td></tr>
            ))}</tbody></table>
        </div>
      )}
    </Modal>
  );
}

const ALIASES: Record<string, string[]> = {
  name: ['name', 'item', 'item name', 'particulars', 'description', 'product'],
  code: ['code', 'sku', 'barcode', 'item code'],
  brand: ['brand', 'make', 'company'],
  category: ['category', 'group', 'type'],
  unit: ['unit', 'uom'],
  cost: ['cost', 'cost price', 'purchase', 'purchase price', 'buy price'],
  price: ['price', 'rate', 'sale price', 'sale', 'selling price', 'mrp'],
  reorder: ['reorder', 'min', 'min stock', 'low stock', 'reorder level'],
  stock: ['stock', 'qty', 'quantity', 'opening', 'opening stock', 'balance'],
  discount: ['discount', 'disc', 'discount %', 'disc %'],
};

function ImportModal({ onClose }: { onClose: () => void }) {
  const { toast, can } = useApp();
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ fresh: number; update: number; skipped: number } | null>(null);
  const showCost = can('cost.view');

  const plan = useMemo(() => {
    const rows = parseCSV(text);
    if (rows.length < 2) return null;
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col: Partial<Record<keyof typeof ALIASES, number>> = {};
    for (const k of Object.keys(ALIASES)) {
      const idx = head.findIndex((h) => ALIASES[k].includes(h));
      if (idx >= 0) col[k] = idx;
    }
    return { rows: rows.slice(1), col, ok: col.name !== undefined };
  }, [text]);

  const run = async () => {
    if (!plan?.ok) return;
    const existing = (await db.items.toArray()).filter((i) => !i.deleted);
    const byCode = new Map(existing.filter((i) => i.code).map((i) => [i.code.toLowerCase(), i]));
    const byName = new Map(existing.map((i) => [`${i.name.toLowerCase()}|${i.brand.toLowerCase()}`, i]));
    const get = (r: string[], k: string) => { const c = plan.col[k]; return c === undefined ? '' : (r[c] ?? '').trim(); };
    let fresh = 0, update = 0, skipped = 0;
    await db.atomic(async () => {
      for (const r of plan.rows) {
        const name = get(r, 'name');
        if (!name) { skipped++; continue; }
        const code = get(r, 'code');
        const brand = get(r, 'brand');
        const found = (code && byCode.get(code.toLowerCase())) || byName.get(`${name.toLowerCase()}|${brand.toLowerCase()}`);
        const disc = get(r, 'discount');
        const base: Item = found ?? {
          id: uuid(), code, name, brand, category: '', unit: 'Pcs', costPaisa: 0, pricePaisa: 0, reorderLevel: 0, discountPct: null, updatedAt: 0, deviceId: '',
        };
        const rec = await db.put<Item>('items', {
          ...base, code: code || base.code, name, brand: brand || base.brand,
          category: get(r, 'category') || base.category, unit: get(r, 'unit') || base.unit,
          costPaisa: showCost && get(r, 'cost') !== '' ? parseRupees(get(r, 'cost')) : base.costPaisa,
          pricePaisa: get(r, 'price') !== '' ? parseRupees(get(r, 'price')) : base.pricePaisa,
          reorderLevel: get(r, 'reorder') !== '' ? Number(get(r, 'reorder')) || 0 : base.reorderLevel,
          discountPct: disc !== '' ? Number(disc) || 0 : base.discountPct ?? null,
        });
        const st = Number(get(r, 'stock'));
        if (found) update++;
        else {
          fresh++;
          if (st) await adjustStock(db, rec.id, st, todayISO(), 'Opening stock (import)', 'opening');
        }
      }
    });
    setResult({ fresh, update, skipped });
    toast(t('Imported {fresh} new, updated {update}', { fresh, update }), 'ok');
  };

  const template = () => download('items-template.csv', toCSV([
    ['code', 'name', 'brand', 'category', 'unit', 'cost', 'price', 'reorder', 'discount', 'stock'],
    ['', 'Clutch Plate Set CG150', 'SAZ', 'Clutch', 'Pcs', 400, 525, 5, '', 20],
  ]));

  return (
    <Modal wide title={t('Import items from CSV')} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{result ? t('Done') : t('Cancel')}</button>
      {!result && <button className="btn primary" onClick={run} disabled={!plan?.ok}>{t('Import')}</button>}
    </>}>
      <p style={{ marginTop: 0 }}>{t('Export your list from Excel as CSV, then choose the file or paste it below. The first row must be column names such as "name, brand, price, cost, stock". Items already in the app (same code, or same name and brand) are updated; stock is only set for new items.')}</p>
      <div className="row mb">
        <input type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        <button className="btn sm" onClick={template}>{t('Download template')}</button>
      </div>
      <textarea style={{ minHeight: 140, fontFamily: 'monospace', fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('…or paste CSV text here')} />
      {plan && (plan.ok
        ? <div className="alert ok mt">{t('Found {n} rows. Columns used: {cols}.', { n: plan.rows.length, cols: Object.keys(plan.col).join(', ') })}</div>
        : <div className="alert bad mt">{t('Could not find an item name column. Name it "name" or "item".')}</div>)}
      {result && <div className="alert ok mt">{result.skipped
        ? t('Added {fresh} new items, updated {update}, skipped {skipped} blank rows.', { fresh: result.fresh, update: result.update, skipped: result.skipped })
        : t('Added {fresh} new items, updated {update}.', { fresh: result.fresh, update: result.update })}</div>}
    </Modal>
  );
}
