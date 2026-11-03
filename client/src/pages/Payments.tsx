import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../lib/db';
import { download, toCSV } from '../lib/csv';
import { fmt, fmtDate, todayISO } from '../lib/money';
import type { Party, Payment } from '../lib/types';
import { useApp } from '../state';
import { Empty, PageHead, useConfirm } from '../components/ui';
import { t, tk } from '../i18n';
import PaymentForm from '../components/PaymentForm';

const METHOD_LABEL = { cash: tk('Cash'), bank: tk('Bank'), cheque: tk('Cheque'), online: tk('Online') };

export default function Payments() {
  const { can, toast } = useApp();
  const [from, setFrom] = useState(todayISO().slice(0, 8) + '01');
  const [to, setTo] = useState(todayISO());
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all');
  const [adding, setAdding] = useState(false);
  const { ask, dialog } = useConfirm();

  const pays = useLiveQuery(async () => {
    const p = (await db.payments.where('date').between(from, to + '￿').toArray()).filter((x) => !x.deleted);
    return p.sort((a, b) => (a.date === b.date ? b.updatedAt - a.updatedAt : a.date < b.date ? 1 : -1));
  }, [from, to], [] as Payment[]);
  const parties = useLiveQuery(async () => new Map<string, Party>((await db.parties.toArray()).map((p) => [p.id, p])), [], new Map<string, Party>());

  const rows = useMemo(() => pays.filter((p) => dir === 'all' || p.direction === dir), [pays, dir]);
  const totalIn = rows.filter((p) => p.direction === 'in').reduce((t, p) => t + p.amountPaisa, 0);
  const totalOut = rows.filter((p) => p.direction === 'out').reduce((t, p) => t + p.amountPaisa, 0);
  const name = (p: Payment) => (p.partyId ? parties.get(p.partyId)?.name ?? t('Unknown') : t('Walk-in / cash sale'));

  const remove = async (p: Payment) => {
    if (await ask(t('Delete this payment of Rs {amount} from {name}? The balance will go back up.', { amount: fmt(p.amountPaisa), name: name(p) }), { ok: t('Delete payment'), danger: true })) {
      await db.softDelete('payments', p.id);
      toast(t('Payment deleted'));
    }
  };
  const exportCsv = () => download(`payments-${from}-to-${to}.csv`, toCSV([
    ['date', 'party', 'direction', 'method', 'reference', 'amount', 'note'],
    ...rows.map((p) => [p.date, p.partyId ? parties.get(p.partyId)?.name ?? 'Unknown' : 'Walk-in / cash sale', p.direction === 'in' ? 'received' : 'paid', p.method, p.ref, p.amountPaisa / 100, p.note]),
  ]));

  return (
    <>
      <PageHead title={t('Payments')}>
        <button className="btn" onClick={exportCsv}>{t('Export CSV')}</button>
        <button className="btn primary" onClick={() => setAdding(true)}>{t('+ Record payment')}</button>
      </PageHead>
      <div className="stats">
        <div className="stat"><div className="label">{t('Received')}</div><div className="value pos">Rs {fmt(totalIn)}</div></div>
        <div className="stat"><div className="label">{t('Paid out')}</div><div className="value neg">Rs {fmt(totalOut)}</div></div>
        <div className="stat"><div className="label">{t('Net')}</div><div className="value">Rs {fmt(totalIn - totalOut)}</div></div>
      </div>
      <div className="card flush">
        <div className="toolbar">
          <label className="row small">{t('From')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
          <label className="row small">{t('To')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
          <select aria-label={t('Show payments')} value={dir} onChange={(e) => setDir(e.target.value as typeof dir)} style={{ width: 'auto' }}>
            <option value="all">{t('Received and paid')}</option><option value="in">{t('Received only')}</option><option value="out">{t('Paid only')}</option>
          </select>
        </div>
        {rows.length === 0 ? <Empty>{t('No payments in this period.')}</Empty> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t('Date')}</th><th>{t('Party')}</th><th>{t('Method')}</th><th>{t('Details')}</th><th className="num">{t('Amount')}</th><th><span className="sr-only">{t('Actions')}</span></th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.date)}</td>
                <td>{p.partyId ? <Link to={`/party/${p.partyId}`}>{name(p)}</Link> : name(p)}</td>
                <td>{t(METHOD_LABEL[p.method]) /* i18n-ok */}</td>
                <td className="small muted">{[p.ref, p.note].filter(Boolean).join(' · ')}</td>
                <td className={`num ${p.direction === 'in' ? 'pos' : 'neg'}`}>{p.direction === 'in' ? '+' : '-'}{fmt(p.amountPaisa)}</td>
                <td className="num">{can('sales.void') && <button className="btn sm danger" onClick={() => remove(p)}>{t('Delete')}</button>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
      {adding && <PaymentForm onClose={() => setAdding(false)} />}
      {dialog}
    </>
  );
}
