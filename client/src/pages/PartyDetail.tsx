import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { buildLedger } from '../lib/ledger';
import type { LedgerRow } from '../lib/ledger';
import { download, toCSV } from '../lib/csv';
import { fmt, fmtDate } from '../lib/money';
import { waLink } from '../lib/share';
import { t, tk } from '../i18n';
import { useApp } from '../state';
import { Empty, PageHead } from '../components/ui';
import PartyForm from '../components/PartyForm';
import PaymentForm from '../components/PaymentForm';

const METHOD_LABEL = { cash: tk('Cash'), bank: tk('Bank'), cheque: tk('Cheque'), online: tk('Online') };

/** Wording for one ledger row, made at display time so it follows the language. */
function rowText(r: LedgerRow): string {
  const no = r.ref;
  switch (r.type) {
    case 'opening': return t('Opening balance');
    case 'sale': return t('Sale {no}', { no });
    case 'purchase': return t('Purchase {no}', { no });
    case 'sale_return': return t('Sale return {no}', { no });
    case 'purchase_return': return t('Purchase return {no}', { no });
    default: {
      const method = t(METHOD_LABEL[r.method ?? 'cash']); // i18n-ok
      const base = r.type === 'payment_in' ? t('Payment received ({method})', { method }) : t('Payment paid ({method})', { method });
      return r.note ? `${base} - ${r.note}` : base;
    }
  }
}

/** English description for the CSV file (data, stays English). */
function csvText(r: LedgerRow): string {
  const label = { opening: 'Opening balance', sale: 'Sale', purchase: 'Purchase', sale_return: 'Sale return', purchase_return: 'Purchase return', payment_in: 'Payment received', payment_out: 'Payment paid' }[r.type];
  const extra = r.type === 'payment_in' || r.type === 'payment_out' ? ` (${r.method ?? 'cash'})${r.note ? ' - ' + r.note : ''}` : r.ref ? ` ${r.ref}` : '';
  return label + extra;
}

export default function PartyDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, shop } = useApp();
  const party = useLiveQuery(async () => (await db.parties.get(id!)) ?? null, [id]);
  const rows = useLiveQuery(() => (party ? buildLedger(db, party) : Promise.resolve([])), [party], []);
  const [from, setFrom] = useState('');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);

  const view = useMemo(() => {
    if (!from) return { forward: null as number | null, list: rows };
    const before = rows.filter((r) => r.date !== '0000-00-00' && r.date < from || r.date === '0000-00-00');
    const fwd = before.length ? before[before.length - 1].balance : 0;
    return { forward: fwd, list: rows.filter((r) => r.date !== '0000-00-00' && r.date >= from) };
  }, [rows, from]);

  if (party === undefined) return <div className="card">{t('Loading…')}</div>;
  if (!party || party.deleted) return <div className="card"><h2>{t('Not found')}</h2><Link to="/customers">{t('Back to customers')}</Link></div>;

  const isCustomer = party.type === 'customer';
  const balance = rows.length ? rows[rows.length - 1].balance : 0;
  const canEdit = isCustomer ? can('parties.edit') : can('suppliers');
  const canPay = can('payments');
  const reminder = isCustomer
    ? t('Assalam o Alaikum {name},\nYour outstanding balance with {shop} is Rs {amount}. Kindly arrange payment at your earliest convenience. Thank you.', { name: party.name, shop: shop.name, amount: fmt(balance) })
    : '';
  const exportCsv = () => download(`statement-${party.name}.csv`, toCSV([
    ['date', 'description', 'debit', 'credit', 'balance'],
    ...rows.map((r) => [r.date === '0000-00-00' ? '' : r.date, csvText(r), r.debit / 100, r.credit / 100, r.balance / 100]),
  ]));

  return (
    <>
      <PageHead title={party.name}>
        <button className="btn" onClick={() => nav(isCustomer ? '/customers' : '/suppliers')}>{t('← Back')}</button>
        {canEdit && <button className="btn" onClick={() => setEdit(true)}>{t('Edit')}</button>}
        {isCustomer && can('sales') && <button className="btn" onClick={() => nav(`/new/sale?party=${party.id}`)}>{t('New sale')}</button>}
        {!isCustomer && can('purchases') && <button className="btn" onClick={() => nav(`/new/purchase?party=${party.id}`)}>{t('New purchase')}</button>}
        {canPay && <button className="btn primary" onClick={() => setPay(true)}>{isCustomer ? t('Receive payment') : t('Pay supplier')}</button>}
      </PageHead>
      <div className="stats no-print">
        <div className="stat"><div className="label">{isCustomer ? t('Owes you') : t('You owe')}</div>
          <div className={`value ${balance > 0 ? 'neg' : balance < 0 ? 'pos' : ''}`}>Rs {fmt(balance)}</div>
          {balance < 0 && <div className="sub">{isCustomer ? t('Customer has paid in advance') : t('Supplier owes you')}</div>}</div>
        <div className="stat"><div className="label">{t('Contact')}</div><div style={{ fontWeight: 600, marginTop: 6 }}>{party.phone || '—'}</div><div className="sub">{[party.area, party.address].filter(Boolean).join(', ')}</div></div>
        {party.creditLimitPaisa > 0 && <div className="stat"><div className="label">{t('Credit limit')}</div><div className="value">Rs {fmt(party.creditLimitPaisa)}</div>
          <div className="sub">{balance > party.creditLimitPaisa ? t('Over the limit') : t('Rs {amount} left', { amount: fmt(party.creditLimitPaisa - balance) })}</div></div>}
      </div>
      <div className="card flush">
        <div className="toolbar no-print">
          <h2 style={{ marginRight: 'auto' }}>{t('Statement')}</h2>
          <label className="row small">{t('From')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
          <button className="btn sm" onClick={exportCsv}>{t('Export CSV')}</button>
          {isCustomer && party.phone && balance > 0 && <a className="btn sm" href={waLink(party.phone, reminder)} target="_blank" rel="noreferrer">{t('WhatsApp reminder')}</a>}
          <button className="btn sm" onClick={() => window.print()}>{t('Print')}</button>
        </div>
        <div className="print-only" style={{ padding: 0 }}>
          <h2>{t('{shop}: account statement', { shop: shop.name })}</h2>
          <div>{party.name} {party.phone && `· ${party.phone}`}</div>
          <div className="small">{party.address}</div>
          <div style={{ margin: '6px 0 10px' }}>{t('Balance')}: <b>Rs {fmt(balance)}</b></div>
        </div>
        {rows.length === 0 ? <Empty>{t('No transactions yet.')}</Empty> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t('Date')}</th><th>{t('Details')}</th><th className="num">{isCustomer ? t('Sale') : t('Purchase')}</th><th className="num">{t('Paid / returned')}</th><th className="num">{t('Balance')}</th></tr></thead>
            <tbody>
              {view.forward !== null && <tr><td /><td><i>{t('Balance brought forward')}</i></td><td /><td /><td className="num">{fmt(view.forward)}</td></tr>}
              {view.list.map((r, i) => {
                const doc = r.type === 'sale' || r.type === 'purchase' || r.type.endsWith('return');
                return (
                  <tr key={i}>
                    <td>{r.date === '0000-00-00' ? '' : fmtDate(r.date)}</td>
                    <td>{rowText(r)}{doc && r.ref && <> · <DocLink no={r.ref} type={r.type} /></>}</td>
                    <td className="num">{r.debit ? fmt(r.debit) : ''}</td>
                    <td className="num">{r.credit ? fmt(r.credit) : ''}</td>
                    <td className="num"><b>{fmt(r.balance)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
      {edit && <PartyForm party={party} type={party.type} onClose={() => setEdit(false)} />}
      {pay && <PaymentForm party={party} onClose={() => setPay(false)} />}
    </>
  );
}

function DocLink({ no, type }: { no: string; type: string }) {
  const doc = useLiveQuery(async () => (await db.docs.where('[kind+no]').equals([type, no]).first()), [no, type]);
  if (!doc) return null;
  return <Link to={`/doc/${doc.id}`} className="no-print small">{t('view')}</Link>;
}
