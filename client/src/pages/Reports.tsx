import { useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { download, toCSV } from '../lib/csv';
import { cashBook, dailySales, salesByItem, stockReport } from '../lib/reports';
import { fmt, fmtDate, fmtQty, todayISO } from '../lib/money';
import type { Doc, Payment } from '../lib/types';
import { useBalances, useItems, useParties, useStock } from '../hooks';
import { useApp } from '../state';
import { Empty, PageHead } from '../components/ui';
import { t, tk } from '../i18n';

type Tab = 'daily' | 'items' | 'stock' | 'receivable' | 'payable' | 'cash';

interface Col<T> { head: string; num?: boolean; cell: (r: T) => ReactNode; csv: (r: T) => string | number }

function Table<T>({ cols, rows, foot, name, empty }: { cols: Col<T>[]; rows: T[]; foot?: ReactNode[]; name: string; empty?: string }) {
  return (
    <div className="card flush">
      <div className="toolbar">
        <span className="muted small">{rows.length === 1 ? t('{n} row', { n: rows.length }) : t('{n} rows', { n: rows.length })}</span><span className="grow" />
        <button className="btn sm" onClick={() => download(`${name}-${todayISO()}.csv`, toCSV([cols.map((c) => c.head), ...rows.map((r) => cols.map((c) => c.csv(r)))]))}>{t('Export CSV')}</button>
        <button className="btn sm" onClick={() => window.print()}>{t('Print')}</button>
      </div>
      {rows.length === 0 ? <Empty>{t(empty ?? tk('Nothing to show for this period.'))}{/* i18n-ok */}</Empty> : (
        <div className="table-wrap"><table className="data">
          <thead><tr>{cols.map((c) => <th key={c.head} className={c.num ? 'num' : ''}>{t(c.head)}</th>)}{/* i18n-ok */}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.head} className={c.num ? 'num' : ''}>{c.cell(r)}</td>)}</tr>)}</tbody>
          {foot && <tfoot><tr>{foot.map((f, i) => <td key={i} className={cols[i]?.num ? 'num' : ''}>{f}</td>)}</tr></tfoot>}
        </table></div>
      )}
    </div>
  );
}

export default function Reports() {
  const { can } = useApp();
  const showCost = can('cost.view');
  const [tab, setTab] = useState<Tab>('daily');
  const [from, setFrom] = useState(todayISO().slice(0, 8) + '01');
  const [to, setTo] = useState(todayISO());
  const items = useItems();
  const stock = useStock();
  const customers = useParties('customer');
  const suppliers = useParties('supplier');
  const balances = useBalances();

  const docs = useLiveQuery(async () => (await db.docs.where('date').between(from, to + '￿').toArray()).filter((d) => !d.deleted), [from, to], [] as Doc[]);
  const pays = useLiveQuery(async () => (await db.payments.where('date').between(from, to + '￿').toArray()).filter((p) => !p.deleted), [from, to], [] as Payment[]);

  const daily = useMemo(() => dailySales(docs), [docs]);
  const byItem = useMemo(() => salesByItem(docs), [docs]);
  const stockRows = useMemo(() => stockReport(items, stock), [items, stock]);
  const cash = useMemo(() => cashBook(pays), [pays]);
  const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  const usesRange = tab === 'daily' || tab === 'items' || tab === 'cash';

  const tabs: [Tab, string][] = [['daily', tk('Daily sales')], ['items', tk('Items sold')], ['stock', tk('Stock')], ['receivable', tk('Customers owe')], ['payable', tk('You owe')], ['cash', tk('Cash book')]];
  const tabName = (k: Tab) => t(tabs.find((x) => x[0] === k)![1]); // i18n-ok
  const owing = (list: typeof customers) => list.map((p) => ({ p, bal: balances.get(p.id) ?? 0 })).filter((r) => r.bal !== 0).sort((a, b) => b.bal - a.bal);

  return (
    <>
      <PageHead title={t('Reports')} />
      <div className="tabs no-print">{tabs.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(label)}</button>)}{/* i18n-ok */}</div>
      {usesRange && (
        <div className="row mb no-print">
          <label className="row small">{t('From')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
          <label className="row small">{t('To')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
          <button className="btn sm" onClick={() => { setFrom(todayISO()); setTo(todayISO()); }}>{t('Today')}</button>
          <button className="btn sm" onClick={() => { setFrom(todayISO().slice(0, 8) + '01'); setTo(todayISO()); }}>{t('This month')}</button>
          <button className="btn sm" onClick={() => { setFrom(todayISO().slice(0, 4) + '-01-01'); setTo(todayISO()); }}>{t('This year')}</button>
        </div>
      )}
      <div className="print-only"><h2>{usesRange ? t('{tab}: {from} to {to}', { tab: tabName(tab), from: fmtDate(from), to: fmtDate(to) }) : tabName(tab)}</h2></div>

      {tab === 'daily' && <Table name="daily-sales" rows={daily} cols={[
        { head: tk('Date'), cell: (r) => fmtDate(r.date), csv: (r) => r.date },
        { head: tk('Invoices'), num: true, cell: (r) => r.invoices, csv: (r) => r.invoices },
        { head: tk('Gross'), num: true, cell: (r) => fmt(r.grossPaisa), csv: (r) => r.grossPaisa / 100 },
        { head: tk('Discount'), num: true, cell: (r) => fmt(r.discountPaisa), csv: (r) => r.discountPaisa / 100 },
        { head: tk('Returns'), num: true, cell: (r) => fmt(r.returnsPaisa), csv: (r) => r.returnsPaisa / 100 },
        { head: tk('Net sales'), num: true, cell: (r) => <b>{fmt(r.netPaisa - r.returnsPaisa)}</b>, csv: (r) => (r.netPaisa - r.returnsPaisa) / 100 },
      ]} foot={[t('Total'), sum(daily, (r) => r.invoices), fmt(sum(daily, (r) => r.grossPaisa)), fmt(sum(daily, (r) => r.discountPaisa)), fmt(sum(daily, (r) => r.returnsPaisa)), fmt(sum(daily, (r) => r.netPaisa - r.returnsPaisa))]} />}

      {tab === 'items' && <>
        {showCost && <div className="stats">
          <div className="stat"><div className="label">{t('Sales (net)')}</div><div className="value">Rs <span className="ltr">{fmt(sum(byItem, (r) => r.netPaisa))}</span></div></div>
          <div className="stat"><div className="label">{t('Cost of goods')}</div><div className="value">Rs <span className="ltr">{fmt(sum(byItem, (r) => r.costPaisa))}</span></div></div>
          <div className="stat"><div className="label">{t('Profit')}</div><div className="value pos">Rs <span className="ltr">{fmt(sum(byItem, (r) => r.profitPaisa))}</span></div>
            <div className="sub">{t('Items with no cost set count as 100% profit')}</div></div>
        </div>}
        <Table name="items-sold" rows={byItem} cols={[
          { head: tk('Item'), cell: (r) => r.name, csv: (r) => r.name },
          { head: tk('Qty sold'), num: true, cell: (r) => fmtQty(r.qty), csv: (r) => r.qty },
          { head: tk('Of which free'), num: true, cell: (r) => r.freeQty ? fmtQty(r.freeQty) : '', csv: (r) => r.freeQty },
          { head: tk('Sales'), num: true, cell: (r) => fmt(r.netPaisa), csv: (r) => r.netPaisa / 100 },
          ...(showCost ? [
            { head: tk('Cost'), num: true, cell: (r: typeof byItem[number]) => fmt(r.costPaisa), csv: (r: typeof byItem[number]) => r.costPaisa / 100 },
            { head: tk('Profit'), num: true, cell: (r: typeof byItem[number]) => <span className={r.profitPaisa < 0 ? 'neg' : ''}>{fmt(r.profitPaisa)}</span>, csv: (r: typeof byItem[number]) => r.profitPaisa / 100 },
          ] : []),
        ]} />
      </>}

      {tab === 'stock' && <>
        <div className="stats">
          <div className="stat"><div className="label">{showCost ? t('Stock value at cost') : t('Stock value at sale price')}</div><div className="value">Rs <span className="ltr">{fmt(sum(stockRows, (r) => (showCost ? r.costValue : r.saleValue)))}</span></div></div>
          <div className="stat"><div className="label">{t('Value at sale price')}</div><div className="value">Rs <span className="ltr">{fmt(sum(stockRows, (r) => r.saleValue))}</span></div></div>
          <div className="stat"><div className="label">{t('Low or empty')}</div><div className="value">{stockRows.filter((r) => r.low).length}</div></div>
        </div>
        <Table name="stock" rows={[...stockRows].sort((a, b) => Number(b.low) - Number(a.low) || a.item.name.localeCompare(b.item.name))} cols={[
          { head: tk('Item'), cell: (r) => <>{r.item.name} {r.low && <span className="badge warn">{t('low')}</span>}</>, csv: (r) => r.item.name },
          { head: tk('Brand'), cell: (r) => r.item.brand, csv: (r) => r.item.brand },
          { head: tk('In stock'), num: true, cell: (r) => `${fmtQty(r.stock)} ${r.item.unit}`, csv: (r) => r.stock },
          ...(showCost ? [{ head: tk('Cost value'), num: true, cell: (r: typeof stockRows[number]) => fmt(r.costValue), csv: (r: typeof stockRows[number]) => r.costValue / 100 }] : []),
          { head: tk('Sale value'), num: true, cell: (r) => fmt(r.saleValue), csv: (r) => r.saleValue / 100 },
        ]} />
      </>}

      {tab === 'receivable' && <Table name="customers-owe" rows={owing(customers)} empty={tk('No customer owes you anything.')} cols={[
        { head: tk('Customer'), cell: (r) => r.p.name, csv: (r) => r.p.name },
        { head: tk('Phone'), cell: (r) => r.p.phone, csv: (r) => r.p.phone },
        { head: tk('Area'), cell: (r) => r.p.area, csv: (r) => r.p.area },
        { head: tk('Balance'), num: true, cell: (r) => <b className={r.bal > 0 ? 'neg' : 'pos'}>{fmt(r.bal)}</b>, csv: (r) => r.bal / 100 },
      ]} foot={[t('Total'), '', '', fmt(sum(owing(customers), (r) => r.bal))]} />}

      {tab === 'payable' && <Table name="suppliers-owed" rows={owing(suppliers)} empty={tk('You owe no supplier anything.')} cols={[
        { head: tk('Supplier'), cell: (r) => r.p.name, csv: (r) => r.p.name },
        { head: tk('Phone'), cell: (r) => r.p.phone, csv: (r) => r.p.phone },
        { head: tk('Balance'), num: true, cell: (r) => <b>{fmt(r.bal)}</b>, csv: (r) => r.bal / 100 },
      ]} foot={[t('Total'), '', fmt(sum(owing(suppliers), (r) => r.bal))]} />}

      {tab === 'cash' && <Table name="cash-book" rows={cash} cols={[
        { head: tk('Date'), cell: (r) => fmtDate(r.date), csv: (r) => r.date },
        { head: tk('Cash in'), num: true, cell: (r) => fmt(r.inCash), csv: (r) => r.inCash / 100 },
        { head: tk('Bank / online in'), num: true, cell: (r) => fmt(r.inBank), csv: (r) => r.inBank / 100 },
        { head: tk('Cash out'), num: true, cell: (r) => fmt(r.outCash), csv: (r) => r.outCash / 100 },
        { head: tk('Bank / online out'), num: true, cell: (r) => fmt(r.outBank), csv: (r) => r.outBank / 100 },
        { head: tk('Net'), num: true, cell: (r) => <b>{fmt(r.inCash + r.inBank - r.outCash - r.outBank)}</b>, csv: (r) => (r.inCash + r.inBank - r.outCash - r.outBank) / 100 },
      ]} foot={[t('Total'), fmt(sum(cash, (r) => r.inCash)), fmt(sum(cash, (r) => r.inBank)), fmt(sum(cash, (r) => r.outCash)), fmt(sum(cash, (r) => r.outBank)), fmt(sum(cash, (r) => r.inCash + r.inBank - r.outCash - r.outBank))]} />}
    </>
  );
}
