import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { getSyncConfig } from '../lib/sync';
import { fmt, fmtDate, fmtQty, todayISO } from '../lib/money';
import type { Doc } from '../lib/types';
import { useBalances, useItems, useParties, useStock } from '../hooks';
import { useApp } from '../state';
import { Empty } from '../components/ui';
import { t } from '../i18n';

const LINK = '\u0001';
/** Puts a React node where the {link} marker was left in a translated sentence. */
function withLink(text: string, node: ReactNode) {
  const [a, b = ''] = text.split(LINK);
  return <>{a}{node}{b}</>;
}

export default function Dashboard() {
  const { user, shop, can } = useApp();
  const nav = useNavigate();
  const items = useItems();
  const stock = useStock();
  const customers = useParties('customer');
  const suppliers = useParties('supplier');
  const balances = useBalances();
  const today = todayISO();
  const monthStart = today.slice(0, 8) + '01';

  const sales = useLiveQuery(async () => {
    const docs = (await db.docs.where('date').between(monthStart, today + '￿').toArray()).filter((d) => !d.deleted && d.status === 'active');
    const net = (k: string, from: string) => docs.filter((d) => d.kind === k && d.date >= from).reduce((a, d) => a + d.netPaisa, 0);
    const cash = (await db.payments.where('date').equals(today).toArray()).filter((p) => !p.deleted);
    return {
      todayNet: net('sale', today) - net('sale_return', today),
      todayCount: docs.filter((d) => d.kind === 'sale' && d.date === today).length,
      monthNet: net('sale', monthStart) - net('sale_return', monthStart),
      cashIn: cash.filter((p) => p.direction === 'in').reduce((a, p) => a + p.amountPaisa, 0),
    };
  }, [today], { todayNet: 0, todayCount: 0, monthNet: 0, cashIn: 0 });

  const recent = useLiveQuery(async () => {
    const all = (await db.docs.orderBy('updatedAt').reverse().limit(60).toArray()).filter((d) => !d.deleted && d.kind === 'sale' || false);
    return all.slice(0, 8) as Doc[];
  }, [], [] as Doc[]);

  const reminder = useLiveQuery(async () => {
    const cfg = await getSyncConfig(db);
    if (cfg.key) return null;
    const last = await db.getMeta<number>('lastBackupAt', 0);
    const hasData = (await db.docs.count()) > 0;
    if (!hasData) return null;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    return days === null || days >= 7 ? { days } : null;
  }, [], null);

  const receivable = customers.reduce((a, p) => a + Math.max(0, balances.get(p.id) ?? 0), 0);
  const payable = suppliers.reduce((a, p) => a + Math.max(0, balances.get(p.id) ?? 0), 0);
  const low = items.filter((i) => i.reorderLevel > 0 && (stock.get(i.id) ?? 0) <= i.reorderLevel);
  const stockValue = items.reduce((a, i) => a + Math.max(0, stock.get(i.id) ?? 0) * i.costPaisa, 0);
  const showMoney = can('reports');
  const topDebtors = [...customers].filter((p) => (balances.get(p.id) ?? 0) > 0).sort((a, b) => (balances.get(b.id) ?? 0) - (balances.get(a.id) ?? 0)).slice(0, 6);

  return (
    <>
      <div className="page-head"><h1>{t('Hello, {name}', { name: user.name })}</h1>
        {can('sales') && <button className="btn primary" onClick={() => nav('/new/sale')}>{t('+ New sale')}</button>}
        {can('payments') && <button className="btn" onClick={() => nav('/payments')}>{t('Receive payment')}</button>}
        {can('purchases') && <button className="btn" onClick={() => nav('/new/purchase')}>{t('+ New purchase')}</button>}
      </div>
      {reminder && <div className="alert mb">{reminder.days === null ? t('You have never exported a backup.') : t('Your last backup was {days} days ago.', { days: reminder.days })} {withLink(t('Open {link} and export a backup so your data is safe if this device is lost.', { link: LINK }), <Link to="/settings">{t('Settings')}</Link>)}</div>}
      {showMoney && (
        <div className="stats">
          <div className="stat"><div className="label">{t("Today's sales")}</div><div className="value">Rs <span className="ltr">{fmt(sales.todayNet)}</span></div><div className="sub">{sales.todayCount === 1 ? t('{n} invoice', { n: 1 }) : t('{n} invoices', { n: sales.todayCount })}</div></div>
          <div className="stat"><div className="label">{t('This month')}</div><div className="value">Rs <span className="ltr">{fmt(sales.monthNet)}</span></div></div>
          <div className="stat"><div className="label">{t('Received today')}</div><div className="value">Rs <span className="ltr">{fmt(sales.cashIn)}</span></div></div>
          <div className="stat"><div className="label">{t('Customers owe you')}</div><div className="value">Rs <span className="ltr">{fmt(receivable)}</span></div></div>
          <div className="stat"><div className="label">{t('You owe suppliers')}</div><div className="value">Rs <span className="ltr">{fmt(payable)}</span></div></div>
          <div className="stat"><div className="label">{t('Stock value (cost)')}</div><div className="value">Rs <span className="ltr">{fmt(stockValue)}</span></div></div>
        </div>
      )}
      {items.length === 0 && can('items.edit') && <div className="alert mb">{withLink(t('No items yet. Add your products under {link} (you can import a CSV list from Excel).', { link: LINK }), <Link to="/items">{t('Items & stock')}</Link>)}</div>}
      <div className="form-grid" style={{ alignItems: 'start' }}>
        {can('sales') && <div className="card flush span2">
          <div className="toolbar"><h2>{t('Latest invoices')}</h2><span className="grow" /><Link to="/sales">{t('All sales')}</Link></div>
          {recent.length === 0 ? <Empty>{t('No invoices yet.')}</Empty> : (
            <div className="table-wrap"><table className="data"><tbody>
              {recent.map((d) => (
                <tr key={d.id} className="click" onClick={() => nav(`/doc/${d.id}`)}>
                  <td><b>{d.no}</b></td><td>{fmtDate(d.date)}</td><td>{d.partyName}</td>
                  <td className="num">{d.status === 'void' ? <span className="badge bad">{t('cancelled')}</span> : fmt(d.netPaisa)}</td>
                </tr>))}
            </tbody></table></div>
          )}
        </div>}
        <div className="col">
          <div className="card flush">
            <div className="toolbar"><h2>{t('Low stock')}</h2><span className="grow" /><Link to="/items">{t('Items')}</Link></div>
            {low.length === 0 ? <Empty>{t('Nothing is running low.')}</Empty> : (
              <table className="data"><tbody>{low.slice(0, 8).map((i) => (
                <tr key={i.id}><td>{i.name}</td><td className="num"><span className={`badge ${(stock.get(i.id) ?? 0) <= 0 ? 'bad' : 'warn'}`}>{fmtQty(stock.get(i.id) ?? 0)} {i.unit}</span></td></tr>
              ))}</tbody></table>
            )}
          </div>
          {showMoney && topDebtors.length > 0 && <div className="card flush">
            <div className="toolbar"><h2>{t('Highest balances')}</h2><span className="grow" /><Link to="/customers">{t('Customers')}</Link></div>
            <table className="data"><tbody>{topDebtors.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav(`/party/${p.id}`)}><td>{p.name}</td><td className="num neg">{fmt(balances.get(p.id) ?? 0)}</td></tr>
            ))}</tbody></table>
          </div>}
        </div>
      </div>
      <p className="hint center mt">{t('{shop} · works offline · data is saved on this device first', { shop: shop.name })}</p>
    </>
  );
}
