import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { download, toCSV } from '../lib/csv';
import { fmt, todayISO } from '../lib/money';
import type { Party, PartyType } from '../lib/types';
import { useBalances, useParties } from '../hooks';
import { useApp } from '../state';
import { Empty, PageHead, useConfirm, useDebounced } from '../components/ui';
import { matches } from '../components/Typeahead';
import { t } from '../i18n';
import PartyForm from '../components/PartyForm';

export default function Parties({ type }: { type: PartyType }) {
  const { can, toast } = useApp();
  const nav = useNavigate();
  const parties = useParties(type);
  const balances = useBalances();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [only, setOnly] = useState(false);
  const [sort, setSort] = useState<'name' | 'balance'>('name');
  const [edit, setEdit] = useState<Party | 'new' | null>(null);
  const { ask, dialog } = useConfirm();
  const word = type === 'customer' ? t('Customers') : t('Suppliers');
  const canEdit = type === 'customer' ? can('parties.edit') : can('suppliers');

  const rows = useMemo(() => {
    const r = parties.filter((p) => matches(`${p.name} ${p.phone} ${p.area} ${p.address}`, dq) && (!only || (balances.get(p.id) ?? 0) !== 0));
    if (sort === 'balance') r.sort((a, b) => (balances.get(b.id) ?? 0) - (balances.get(a.id) ?? 0));
    return r;
  }, [parties, balances, dq, only, sort]);
  const total = parties.reduce((t, p) => t + Math.max(0, balances.get(p.id) ?? 0), 0);

  const remove = async (p: Party) => {
    if (await ask(t('Delete {name}? Their old invoices stay in your records.', { name: p.name }), { ok: t('Delete'), danger: true })) {
      await db.softDelete('parties', p.id);
      toast(t('{name} deleted', { name: p.name }));
    }
  };
  const exportCsv = () => download(`${type}s-${todayISO()}.csv`, toCSV([
    ['name', 'phone', 'area', 'address', 'balance'],
    ...parties.map((p) => [p.name, p.phone, p.area, p.address, (balances.get(p.id) ?? 0) / 100]),
  ]));

  return (
    <>
      <PageHead title={word}>
        <button className="btn" onClick={exportCsv}>{t('Export CSV')}</button>
        {canEdit && <button className="btn primary" onClick={() => setEdit('new')}>{type === 'customer' ? t('+ New customer') : t('+ New supplier')}</button>}
      </PageHead>
      <div className="stats">
        <div className="stat"><div className="label">{word}</div><div className="value">{parties.length}</div></div>
        <div className="stat"><div className="label">{type === 'customer' ? t('Total to receive') : t('Total to pay')}</div><div className="value">Rs {fmt(total)}</div></div>
      </div>
      <div className="card flush">
        <div className="toolbar">
          <input className="search" type="search" placeholder={t('Search name, phone, area…')} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> {t('Only with balance')}</label>
          <select aria-label={t('Sort by')} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: 'auto' }}>
            <option value="name">{t('Sort by name')}</option><option value="balance">{t('Highest balance first')}</option>
          </select>
        </div>
        {rows.length === 0 ? <Empty>{parties.length ? t('Nothing matches.') : type === 'customer' ? t('No customers yet.') : t('No suppliers yet.')}</Empty> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t('Name')}</th><th>{t('Area')}</th><th>{t('Phone')}</th><th className="num">{type === 'customer' ? t('Owes you') : t('You owe')}</th><th><span className="sr-only">{t('Actions')}</span></th></tr></thead>
            <tbody>{rows.map((p) => {
              const b = balances.get(p.id) ?? 0;
              const over = p.creditLimitPaisa > 0 && b > p.creditLimitPaisa;
              return (
                <tr key={p.id} className="click" onClick={() => nav(`/party/${p.id}`)}>
                  <td><b>{p.name}</b>{over && <> <span className="badge bad">{t('over limit')}</span></>}</td>
                  <td>{p.area}</td><td>{p.phone}</td>
                  <td className={`num ${b > 0 ? 'neg' : b < 0 ? 'pos' : ''}`}>{fmt(b)}</td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    {canEdit && <><button className="btn sm" onClick={() => setEdit(p)}>{t('Edit')}</button>{' '}
                      {can('settings') && <button className="btn sm danger" onClick={() => remove(p)}>{t('Delete')}</button>}</>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
      {edit && <PartyForm type={type} party={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {dialog}
    </>
  );
}
