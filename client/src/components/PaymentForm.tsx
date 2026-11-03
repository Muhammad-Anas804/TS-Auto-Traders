import { useState } from 'react';
import { db } from '../lib/db';
import { recordPayment } from '../lib/docs';
import { fmt, parseRupees, todayISO } from '../lib/money';
import type { PayMethod, Party } from '../lib/types';
import { useBalances, useParties } from '../hooks';
import { useApp } from '../state';
import { t } from '../i18n';
import { Field, Modal } from './ui';
import PartyPicker from './PartyPicker';

export default function PaymentForm({ party, onClose, onSaved }: { party?: Party; onClose: () => void; onSaved?: () => void }) {
  const { user, toast } = useApp();
  const parties = useParties();
  const balances = useBalances();
  const [p, setP] = useState<Party | null>(party ?? null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [date, setDate] = useState(todayISO());
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const isCustomer = p?.type !== 'supplier';
  const bal = p ? balances.get(p.id) ?? 0 : 0;

  const save = async () => {
    if (!p) { toast(t('Choose who this payment is with'), 'err'); return; }
    setSaving(true);
    try {
      await recordPayment(db, {
        partyId: p.id, direction: isCustomer ? 'in' : 'out', amountPaisa: parseRupees(amount), method, date, ref, note, userId: user.id,
      });
      toast(isCustomer ? t('Payment received') : t('Payment recorded'), 'ok');
      onSaved?.();
      onClose();
    } catch (e) { toast((e as Error).message, 'err'); setSaving(false); }
  };

  return (
    <Modal title={party ? (isCustomer ? t('Receive payment from {name}', { name: party.name }) : t('Pay {name}', { name: party.name })) : t('Record a payment')} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{t('Cancel')}</button>
      <button className="btn primary" onClick={save} disabled={saving}>{isCustomer ? t('Save receipt') : t('Save payment')}</button>
    </>}>
      <div className="form-grid">
        {!party && <Field label={t('Customer or supplier')} className="span2">
          <PartyPicker parties={parties} value={p} onPick={setP} balances={balances} autoFocus />
        </Field>}
        {p && <div className="span2 small">
          {isCustomer ? t('Customer owes you') : t('You owe supplier')}: <b className={bal > 0 ? 'neg' : ''}>Rs {fmt(bal)}</b>
          {bal > 0 && <> · <a href="#" onClick={(e) => { e.preventDefault(); setAmount(String(bal / 100)); }}>{t('fill full amount')}</a></>}
        </div>}
        <Field label={t('Amount (Rs)')}><input type="number" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus={!!party} /></Field>
        <Field label={t('Method')}>
          <select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            <option value="cash">{t('Cash')}</option><option value="bank">{t('Bank transfer')}</option>
            <option value="cheque">{t('Cheque')}</option><option value="online">{t('Easypaisa / JazzCash / online')}</option>
          </select>
        </Field>
        <Field label={t('Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('Reference')} hint={t('Cheque no., transaction id')}><input type="text" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label={t('Note')} className="span2"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
