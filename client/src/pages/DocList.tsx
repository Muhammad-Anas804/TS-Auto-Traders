import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { download, toCSV } from '../lib/csv';
import { fmt, fmtDate, todayISO } from '../lib/money';
import type { Doc, DocKind } from '../lib/types';
import { useApp } from '../state';
import { t } from '../i18n';
import { partyDisplay } from '../lib/share';
import { Empty, PageHead, useDebounced } from '../components/ui';

function monthStart(): string { const d = new Date(); d.setDate(1); return todayISO(d); }

export default function DocList({ kinds, title, newTo }: { kinds: DocKind[]; title: string; newTo: string }) {
  const nav = useNavigate();
  const { can } = useApp();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [showVoid, setShowVoid] = useState(false);
  const [limit, setLimit] = useState(100);
  const canNew = can(kinds[0] === 'sale' || kinds[0] === 'sale_return' ? 'sales' : 'purchases');

  const docs = useLiveQuery(async () => {
    const all = await db.docs.where('kind').anyOf(kinds).toArray();
    return all.filter((d) => !d.deleted).sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  }, [kinds.join()], [] as Doc[]);
  const paid = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.payments.each((p) => { if (!p.deleted && p.docId) m.set(p.docId, (m.get(p.docId) ?? 0) + p.amountPaisa); });
    return m;
  }, [], new Map<string, number>());

  const rows = useMemo(() => docs.filter((d) => {
    if (d.date < from || d.date > to) return false;
    if (!showVoid && d.status === 'void') return false;
    const needle = dq.trim().toLowerCase();
    return !needle || d.no.toLowerCase().includes(needle) || d.partyName.toLowerCase().includes(needle);
  }), [docs, from, to, dq, showVoid]);
  const total = rows.filter((d) => d.status === 'active').reduce((sum, d) => sum + d.netPaisa, 0);

  const exportCsv = () => download(`${kinds[0]}-${from}-to-${to}.csv`, toCSV([
    ['no', 'date', 'party', 'lines', 'gross', 'discount', 'net', 'paid', 'status'],
    ...rows.map((d) => [d.no, d.date, d.partyName, d.lines.length, d.grossPaisa / 100, (d.lineDiscountPaisa + d.extraDiscountPaisa) / 100, d.netPaisa / 100, (paid.get(d.id) ?? 0) / 100, d.status]),
  ]));

  return (
    <>
      <PageHead title={title}>
        <button className="btn" onClick={exportCsv}>{t('Export CSV')}</button>
        {canNew && <button className="btn primary" onClick={() => nav(newTo)}>{t('+ New')}</button>}
      </PageHead>
      <div className="card flush">
        <div className="toolbar">
          <input className="search" type="search" placeholder={t('Search invoice no. or name…')} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="row small">{t('From')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
          <label className="row small">{t('To')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
          <label className="check small"><input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} /> {t('Show cancelled')}</label>
        </div>
        {rows.length === 0 ? <Empty>{t('No documents in this period.')}</Empty> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t('No.')}</th><th>{t('Date')}</th><th>{t('Party')}</th><th className="num">{t('Lines')}</th><th className="num">{t('Net')}</th><th className="num">{t('Paid with it')}</th><th><span className="sr-only">{t('Actions')}</span></th></tr></thead>
            <tbody>{rows.slice(0, limit).map((d) => (
              <tr key={d.id} className="click" onClick={() => nav(`/doc/${d.id}`)} style={d.status === 'void' ? { opacity: .55 } : undefined}>
                <td><b>{d.no}</b></td><td>{fmtDate(d.date)}</td><td>{partyDisplay(d.partyName)}</td>
                <td className="num">{d.lines.length}</td>
                <td className="num">{d.status === 'void' ? <s>{fmt(d.netPaisa)}</s> : fmt(d.netPaisa)}</td>
                <td className="num">{paid.get(d.id) ? fmt(paid.get(d.id)!) : ''}</td>
                <td>{d.status === 'void' && <span className="badge bad">{t('Cancelled')}</span>}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={4}>{rows.length === 1 ? t('{n} document', { n: rows.length }) : t('{n} documents', { n: rows.length })}</td><td className="num">{fmt(total)}</td><td colSpan={2} /></tr></tfoot>
          </table>
          {rows.length > limit && <div className="center" style={{ padding: 12 }}><button className="btn" onClick={() => setLimit(limit + 200)}>{t('Show more')}</button></div>}</div>
        )}
      </div>
    </>
  );
}
