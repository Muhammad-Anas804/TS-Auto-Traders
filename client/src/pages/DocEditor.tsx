import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uuid } from '../lib/db';
import { blankLine, computeLine, computeTotals } from '../lib/calc';
import { saveDoc, ValidationError } from '../lib/docs';
import { fmt, fmtQty, parseRupees, todayISO } from '../lib/money';
import { docTitle, WALK_IN } from '../lib/share';
import { t } from '../i18n';
import type { Doc, DocKind, Item, Line, PayMethod, Party } from '../lib/types';
import { useBalances, useItems, useParties, useStock } from '../hooks';
import { useApp } from '../state';
import { Field, NumInput, PageHead } from '../components/ui';
import Typeahead, { matches } from '../components/Typeahead';
import PartyPicker from '../components/PartyPicker';
import ItemForm from '../components/ItemForm';
import PartyForm from '../components/PartyForm';
import type { Perm } from '../lib/auth';

const KINDS: DocKind[] = ['sale', 'purchase', 'sale_return', 'purchase_return'];
const PERM: Record<DocKind, Perm> = { sale: 'sales', sale_return: 'sales', purchase: 'purchases', purchase_return: 'purchases' };
/** Documents that take goods OUT of the shelf. */
const OUTGOING: DocKind[] = ['sale', 'purchase_return'];
const FIELDS = ['item', 'qty', 'rate', 'disc'] as const;
type FieldName = (typeof FIELDS)[number];

export default function DocEditor() {
  const params = useParams();
  const [search] = useSearchParams();
  const nav = useNavigate();
  const { can, toast } = useApp();

  const editingId = params.id;
  const existing = useLiveQuery(async (): Promise<Doc | null> => (editingId ? (await db.docs.get(editingId)) ?? null : null), [editingId]);
  const kind: DocKind | null = editingId ? existing?.kind ?? null : KINDS.includes(params.kind as DocKind) ? (params.kind as DocKind) : null;

  if (editingId && existing === undefined) return <div className="card">{t('Loading…')}</div>;
  if (editingId && !existing) return <div className="card">{t('Document not found.')}</div>;
  if (!kind) return <div className="card">{t('Unknown document type.')}</div>;
  if (!can(PERM[kind]) || (editingId && !can('sales.edit'))) {
    return <div className="card"><h2>{t('Not allowed')}</h2><p className="muted">{editingId ? t('Your role cannot edit this document.') : t('Your role cannot create this document.')}</p></div>;
  }
  return <Editor key={editingId ?? kind} kind={kind} existing={existing ?? undefined} presetParty={search.get('party')} nav={nav} toast={toast} />;
}

interface EditorProps {
  kind: DocKind; existing?: Doc; presetParty: string | null;
  nav: ReturnType<typeof useNavigate>; toast: ReturnType<typeof useApp>['toast'];
}

function Editor({ kind, existing, presetParty, nav, toast }: EditorProps) {
  const { user, shop } = useApp();
  const items = useItems();
  const stock = useStock();
  const balances = useBalances();
  const isSaleSide = kind === 'sale' || kind === 'sale_return';
  const parties = useParties(isSaleSide ? 'customer' : 'supplier');
  const title = docTitle(kind);
  const opts = useMemo(() => ({ roundDiscountToRupee: shop.roundDiscountToRupee }), [shop.roundDiscountToRupee]);

  const [party, setParty] = useState<Party | null>(null);
  const [walkIn, setWalkIn] = useState(existing && !existing.partyId && existing.partyName !== WALK_IN ? existing.partyName : '');
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [poNo, setPoNo] = useState(existing?.poNo ?? '');
  const [poDate, setPoDate] = useState(existing?.poDate ?? '');
  const [challanNo, setChallanNo] = useState(existing?.challanNo ?? '');
  const [challanDate, setChallanDate] = useState(existing?.challanDate ?? '');
  const [terms, setTerms] = useState(existing?.terms ?? shop.invoiceTerms);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() => existing?.lines.map((l) => ({ ...l })) ?? [blankLine(uuid())]);
  const [extraDisc, setExtraDisc] = useState(existing ? existing.extraDiscountPaisa / 100 : 0);
  const [payNow, setPayNow] = useState(0);
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [updateCost, setUpdateCost] = useState(kind === 'purchase');
  const [saving, setSaving] = useState(false);
  const [nextNo, setNextNo] = useState('');
  const [addItemFor, setAddItemFor] = useState<{ lineId: string; name: string } | null>(null);
  const [addParty, setAddParty] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const refs = useRef(new Map<string, HTMLInputElement | null>());
  const [focusReq, setFocusReq] = useState<{ lineId: string; field: FieldName } | null>(null);

  // Load the party for an existing document (even if it was deleted since) or a preset ?party=ID.
  useEffect(() => {
    const id = existing?.partyId || presetParty;
    if (id) void db.parties.get(id).then((p) => { if (p) setParty(p); });
  }, [existing?.partyId, presetParty]);
  useEffect(() => { if (!existing) void db.peekDocNo(kind).then(setNextNo); }, [existing, kind]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  useEffect(() => {
    if (!focusReq) return;
    refs.current.get(`${focusReq.lineId}:${focusReq.field}`)?.focus();
    setFocusReq(null);
  }, [focusReq, lines]);

  const touch = () => setDirty(true);
  const computed = useMemo(() => lines.map((l) => computeLine(l, opts)), [lines, opts]);
  const totals = useMemo(() => computeTotals(computed.filter((l) => l.name.trim() || l.itemId), Math.round(extraDisc * 100)), [computed, extraDisc]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const patch = (id: string, p: Partial<Line>) => { touch(); setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l))); };
  const addLine = (focus = true) => {
    const l = blankLine(uuid());
    setLines((ls) => [...ls, l]);
    if (focus) setFocusReq({ lineId: l.id, field: 'item' });
  };
  const removeLine = (id: string) => { touch(); setLines((ls) => (ls.length === 1 ? [blankLine(uuid())] : ls.filter((l) => l.id !== id))); };

  const defaultDisc = (item: Item): number => {
    if (kind !== 'sale') return 0;
    if (item.discountPct != null) return item.discountPct;
    return party ? party.defaultDiscountPct : shop.defaultDiscountPct;
  };
  const pick = (lineId: string, item: Item) => {
    const buying = kind === 'purchase' || kind === 'purchase_return';
    patch(lineId, {
      itemId: item.id, name: item.name, unit: item.unit,
      ratePaisa: buying ? item.costPaisa || item.pricePaisa : item.pricePaisa,
      costPaisa: item.costPaisa, discountMode: 'pct', discountPct: defaultDisc(item), discountPaisa: 0, bonus: false,
    });
    setFocusReq({ lineId, field: 'qty' });
  };
  const nextField = (lineId: string, f: FieldName) => {
    const i = FIELDS.indexOf(f);
    if (i < FIELDS.length - 1) { setFocusReq({ lineId, field: FIELDS[i + 1] }); return; }
    const idx = lines.findIndex((l) => l.id === lineId);
    if (idx === lines.length - 1) addLine(true);
    else setFocusReq({ lineId: lines[idx + 1].id, field: 'item' });
  };
  const setRef = (lineId: string, f: FieldName) => (el: HTMLInputElement | null) => { refs.current.set(`${lineId}:${f}`, el); };
  const enter = (lineId: string, f: FieldName) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); nextField(lineId, f); }
  };

  // ---- stock & credit warnings ----
  const wasActive = existing?.status === 'active';
  const prevQty = (itemId: string) => (wasActive ? existing!.lines.filter((l) => l.itemId === itemId).reduce((sum, l) => sum + l.qty, 0) : 0);
  const outgoing = OUTGOING.includes(kind);
  const requested = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of computed) if (l.itemId) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return m;
  }, [computed]);
  const available = (itemId: string) => {
    const s = stock.get(itemId) ?? 0;
    // Editing: our own previous lines already left (or entered) the shelf, so give that quantity back for the check.
    return outgoing ? s + prevQty(itemId) : s;
  };
  const shortOf = (itemId: string) => (outgoing ? (requested.get(itemId) ?? 0) - available(itemId) : 0);

  const partyBal = party ? balances.get(party.id) ?? 0 : 0;
  const ownEffect = existing && existing.status === 'active' && existing.partyId === party?.id
    ? (kind === 'sale' || kind === 'purchase' ? existing.netPaisa : -existing.netPaisa) : 0;
  const baseBal = partyBal - ownEffect;
  const sign = kind === 'sale' || kind === 'purchase' ? 1 : -1;
  const walkInSale = kind === 'sale' && !party;
  const paidPaisa = existing ? 0 : walkInSale ? totals.netPaisa : Math.min(parseRupees(payNow), totals.netPaisa);
  const newBal = baseBal + sign * totals.netPaisa - paidPaisa;
  const overLimit = isSaleSide && kind === 'sale' && party && party.creditLimitPaisa > 0 && newBal > party.creditLimitPaisa;
  const filled = computed.filter((l) => l.name.trim() || l.itemId);

  const save = async (andPrint: boolean) => {
    if (saving) return;
    if (!party && kind !== 'sale') { toast(isSaleSide ? t('Choose the customer first') : t('Choose the supplier first'), 'err'); return; }
    if (!shop.allowNegativeStock && outgoing) {
      for (const [id, q] of requested) {
        const av = available(id);
        if (q > av) { toast(t('Not enough stock for {name}: have {have}, need {need}', { name: itemById.get(id)?.name ?? t('an item'), have: fmtQty(av), need: fmtQty(q) }), 'err'); return; }
      }
    }
    setSaving(true);
    try {
      const doc = await saveDoc(db, {
        id: existing?.id, kind, date, party, partyNameOverride: walkIn || WALK_IN,
        poNo, poDate, challanNo, challanDate, terms, notes, lines,
        extraDiscountPaisa: Math.round(extraDisc * 100),
        payNowPaisa: existing ? 0 : paidPaisa, payMethod, userId: user.id,
      });
      if (kind === 'purchase' && updateCost) {
        for (const l of doc.lines) {
          const it = l.itemId ? itemById.get(l.itemId) : undefined;
          if (!it || l.bonus || l.qty <= 0 || l.netPaisa <= 0) continue;
          const unitCost = Math.round(l.netPaisa / l.qty);
          if (unitCost !== it.costPaisa) await db.put<Item>('items', { ...it, costPaisa: unitCost });
        }
      }
      setDirty(false);
      toast(t('{title} {no} saved', { title, no: doc.no }), 'ok');
      nav(`/doc/${doc.id}${andPrint ? '?print=1' : ''}`, { replace: true });
    } catch (e) {
      toast(e instanceof ValidationError ? e.message : (e as Error).message, 'err');
      setSaving(false);
    }
  };

  const itemOptions = (text: string) => {
    return items.filter((i) => matches(`${i.name} ${i.code} ${i.brand}`, text)).slice(0, 25).map((i) => {
      const s = stock.get(i.id) ?? 0;
      return {
        key: i.id,
        label: <span><b>{i.name}</b>{i.brand && <span className="muted"> · {i.brand}</span>}{i.code && <span className="muted"> · {i.code}</span>}</span>,
        meta: <>Rs {fmt(i.pricePaisa)} · <span style={{ color: s <= 0 ? 'var(--bad)' : undefined }}>{fmtQty(s)} {i.unit}</span></>,
      };
    });
  };

  const partyLabel = kind === 'sale' ? t('Customer (or type a walk-in name)') : isSaleSide ? t('Customer *') : t('Supplier *');
  const refLabel = kind === 'purchase' ? t("Supplier's invoice no.") : t('Purchase order no.');
  const payLabel = kind === 'purchase' ? t('Paid now (Rs)') : kind === 'sale_return' ? t('Refunded now (Rs)') : t('Received now (Rs)');
  const lineCount = filled.length === 1 ? t('{n} line · Net Rs {amount}', { n: filled.length, amount: fmt(totals.netPaisa) }) : t('{n} lines · Net Rs {amount}', { n: filled.length, amount: fmt(totals.netPaisa) });

  return (
    <>
      <PageHead title={existing ? t('Edit {title} {no}', { title, no: existing.no }) : t('New {title}', { title })}>
        <button className="btn" onClick={() => { if (!dirty || confirm(t('Discard this document?'))) nav(-1); }}>{t('Cancel')}</button>
      </PageHead>

      <div className="card mb">
        <div className="form-grid">
          <Field label={partyLabel} className="span2">
            <PartyPicker
              parties={parties} value={party} balances={balances} autoFocus={!existing && !presetParty}
              textValue={walkIn} onText={(txt) => { touch(); setWalkIn(txt); }}
              onPick={(p) => { touch(); setParty(p); if (p) setWalkIn(''); }}
              onAdd={(typed) => setAddParty(typed)}
            />
          </Field>
          <Field label={t('Date')}><input type="date" value={date} onChange={(e) => { touch(); setDate(e.target.value); }} /></Field>
          <Field label={t('{title} no.', { title })}><input type="text" value={existing?.no ?? nextNo} disabled /></Field>
        </div>
        {party && <div className="row small mt" style={{ marginBottom: 0 }}>
          <span className="muted">{[party.phone, party.area].filter(Boolean).join(' · ')}</span>
          <span className="grow" />
          <span>{isSaleSide ? t('Owes you') : t('You owe')}: <b className={baseBal > 0 ? 'neg' : ''}>Rs {fmt(baseBal)}</b>
            {party.creditLimitPaisa > 0 && <span className="muted"> {t('(limit {amount})', { amount: fmt(party.creditLimitPaisa) })}</span>}</span>
        </div>}
        {walkInSale && <div className="hint mt" style={{ marginBottom: 0 }}>{t('No customer chosen: this is a cash sale, paid in full. Pick a customer to sell on credit.')}</div>}
      </div>

      <div className="card flush mb">
        <div className="table-wrap">
          <table className="lines">
            <thead><tr>
              <th>#</th><th style={{ width: '34%', minWidth: 220 }}>{t('Particulars')}</th><th style={{ width: 90 }}>{t('Qty')}</th><th style={{ width: 110 }}>{t('Rate')}</th>
              <th style={{ width: 150 }}>{t('Discount')}</th><th>{t('Free')}</th>
              <th className="num" style={{ width: 100, textAlign: 'end' }}>{t('Gross')}</th><th style={{ width: 90, textAlign: 'end' }}>{t('Disc.')}</th>
              <th style={{ width: 110, textAlign: 'end' }}>{t('Net')}</th><th><span className="sr-only">{t('Actions')}</span></th>
            </tr></thead>
            <tbody>
              {lines.map((raw, idx) => {
                const l = computed[idx];
                const item = raw.itemId ? itemById.get(raw.itemId) : undefined;
                const short = raw.itemId ? shortOf(raw.itemId) : 0;
                const unlinked = raw.name.trim() !== '' && !raw.itemId;
                return (
                  <tr key={raw.id} className={raw.bonus ? 'bonus' : unlinked ? 'warn' : ''}
                    onKeyDown={(e) => { if (e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); patch(raw.id, { bonus: !raw.bonus }); } }}>
                    <td className="sn">{idx + 1}</td>
                    <td>
                      <Typeahead
                        value={raw.name}
                        placeholder={t('Search item by name, code or brand…')}
                        inputRef={setRef(raw.id, 'item')}
                        options={itemOptions(raw.name)}
                        onChange={(txt) => patch(raw.id, { name: txt, itemId: raw.itemId && itemById.get(raw.itemId)?.name === txt ? raw.itemId : null })}
                        onPick={(id) => { const it = itemById.get(id); if (it) pick(raw.id, it); }}
                        addLabel={raw.name.trim() ? t('Add "{name}" as a new item', { name: raw.name.trim() }) : undefined}
                        onAdd={() => setAddItemFor({ lineId: raw.id, name: raw.name.trim() })}
                        onEnterWhenClosed={() => nextField(raw.id, 'item')}
                        minListWidth={420}
                      />
                      {item && <div className={`stockhint ${short > 0 ? 'bad' : ''}`}>
                        {short > 0 ? t('Only {qty} {unit} in stock', { qty: fmtQty(available(item.id)), unit: item.unit }) : t('In stock: {qty} {unit}', { qty: fmtQty(stock.get(item.id) ?? 0), unit: item.unit })}
                      </div>}
                      {unlinked && <div className="stockhint">{t('Not in your item list: no stock change. Pick from the list to track stock.')}</div>}
                    </td>
                    <td><NumInput value={raw.qty} onChange={(n) => patch(raw.id, { qty: n })} inputRef={setRef(raw.id, 'qty')} onKeyDown={enter(raw.id, 'qty')} placeholder="1" /></td>
                    <td><NumInput value={raw.ratePaisa / 100} onChange={(n) => patch(raw.id, { ratePaisa: Math.round(n * 100) })} inputRef={setRef(raw.id, 'rate')} onKeyDown={enter(raw.id, 'rate')} /></td>
                    <td>
                      <div className="row nowrap" style={{ gap: 4 }}>
                        <NumInput
                          value={raw.discountMode === 'pct' ? raw.discountPct : raw.discountPaisa / 100} disabled={raw.bonus}
                          onChange={(n) => patch(raw.id, raw.discountMode === 'pct' ? { discountPct: n } : { discountPaisa: Math.round(n * 100) })}
                          inputRef={setRef(raw.id, 'disc')} onKeyDown={enter(raw.id, 'disc')}
                        />
                        <select style={{ width: 62, padding: '0 4px' }} disabled={raw.bonus} value={raw.discountMode}
                          onChange={(e) => patch(raw.id, { discountMode: e.target.value as 'pct' | 'amount' })} aria-label={t('Discount type')}>
                          <option value="pct">%</option><option value="amount">Rs</option>
                        </select>
                      </div>
                    </td>
                    <td className="center" style={{ paddingTop: 9 }}><input type="checkbox" checked={raw.bonus} onChange={(e) => patch(raw.id, { bonus: e.target.checked })} title={t('Free quantity (100% discount)')} aria-label={t('Free item')} /></td>
                    <td className="calc">{fmt(l.grossPaisa)}</td>
                    <td className="calc">{l.discountPaisa ? fmt(l.discountPaisa) : '0.00'}</td>
                    <td className="calc"><b>{fmt(l.netPaisa)}</b></td>
                    <td><button className="btn sm ghost" onClick={() => removeLine(raw.id)} aria-label={t('Remove line')} title={t('Remove line')}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="toolbar" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
          <button className="btn" onClick={() => addLine(true)}>{t('+ Add line')}</button>
          <span className="hint">{t('Tip: Enter jumps to the next box (and adds a new line at the end). Alt+F marks the current line as free.')}</span>
        </div>
      </div>

      <div className="form-grid mb" style={{ alignItems: 'start' }}>
        <div className="card span2">
          <details open={!!(existing && (existing.poNo || existing.challanNo))}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 10 }}>{t('Reference details (optional)')}</summary>
            <div className="form-grid">
              <Field label={refLabel} hint={kind === 'sale' ? t('Printed as the invoice number if empty') : undefined}><input type="text" value={poNo} onChange={(e) => { touch(); setPoNo(e.target.value); }} /></Field>
              <Field label={t('Date')}><input type="date" value={poDate} onChange={(e) => { touch(); setPoDate(e.target.value); }} /></Field>
              <Field label={t('Delivery challan no.')}><input type="text" value={challanNo} onChange={(e) => { touch(); setChallanNo(e.target.value); }} /></Field>
              <Field label={t('Challan date')}><input type="date" value={challanDate} onChange={(e) => { touch(); setChallanDate(e.target.value); }} /></Field>
              <Field label={t('Terms of payment')} className="span2"><input type="text" value={terms} onChange={(e) => { touch(); setTerms(e.target.value); }} /></Field>
            </div>
          </details>
          <Field label={t('Notes (printed on the invoice)')} className="mt"><textarea value={notes} onChange={(e) => { touch(); setNotes(e.target.value); }} /></Field>
          {kind === 'purchase' && <label className="check mt"><input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} /> {t("Update each item's purchase cost from this bill")}</label>}
        </div>

        <div className="card">
          <div className="totals">
            <div className="t"><span>{t('Total quantity')}</span><span>{fmtQty(totals.totalQty)}</span></div>
            <div className="t"><span>{t('Gross amount')}</span><span>{fmt(totals.grossPaisa)}</span></div>
            <div className="t"><span>{t('Line discounts')}</span><span>{fmt(totals.lineDiscountPaisa)}</span></div>
            <div className="t"><span>{t('Extra discount (Rs)')}</span>
              <NumInput value={extraDisc} onChange={(n) => { touch(); setExtraDisc(n); }} /></div>
            <div className="t big"><span>{t('Net total')}</span><span>Rs {fmt(totals.netPaisa)}</span></div>
            {!existing && !walkInSale && <>
              <div className="t" style={{ marginTop: 10 }}><span>{payLabel}</span>
                <NumInput value={payNow} onChange={(n) => { touch(); setPayNow(n); }} /></div>
              <div className="t"><span>{t('Method')}</span>
                <select style={{ width: 130 }} value={payMethod} onChange={(e) => setPayMethod(e.target.value as PayMethod)}>
                  <option value="cash">{t('Cash')}</option><option value="bank">{t('Bank')}</option><option value="cheque">{t('Cheque')}</option><option value="online">{t('Online')}</option>
                </select></div>
            </>}
            {party && <div className="t" style={{ marginTop: 6 }}><span>{isSaleSide ? t('Balance after this') : t('You will owe after this')}</span>
              <b className={newBal > 0 ? 'neg' : ''}>Rs {fmt(newBal)}</b></div>}
            {walkInSale && <div className="t"><span>{t('Paid in cash')}</span><b>Rs {fmt(totals.netPaisa)}</b></div>}
          </div>
          {overLimit && <div className="alert bad mt">{t('Over the credit limit of Rs {amount}.', { amount: fmt(party!.creditLimitPaisa) })}</div>}
          {existing && <p className="hint">{t('Payments already taken stay as they are; add or change them under Payments.')}</p>}
        </div>
      </div>

      <div className="sticky-actions no-print">
        <span className="muted small" style={{ marginRight: 'auto', alignSelf: 'center' }}>{lineCount}</span>
        <button className="btn" onClick={() => save(false)} disabled={saving}>{t('Save')}</button>
        <button className="btn primary" onClick={() => save(true)} disabled={saving}>{t('Save & print')}</button>
      </div>

      {addItemFor && (
        <ItemForm
          initialName={addItemFor.name}
          initialPricePaisa={computed.find((l) => l.id === addItemFor.lineId)?.ratePaisa}
          onClose={() => setAddItemFor(null)}
          onSaved={(it) => pick(addItemFor.lineId, it)}
        />
      )}
      {addParty !== null && (
        <PartyForm type={isSaleSide ? 'customer' : 'supplier'} initialName={addParty} onClose={() => setAddParty(null)} onSaved={(p) => { setParty(p); setWalkIn(''); touch(); }} />
      )}
    </>
  );
}
