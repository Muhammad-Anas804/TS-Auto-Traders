import { useState } from 'react';
import { db, uuid } from '../lib/db';
import { parseRupees } from '../lib/money';
import type { Party, PartyType } from '../lib/types';
import { useApp } from '../state';
import { Field, Modal } from './ui';
import { t } from '../i18n';

export default function PartyForm({ party, type, initialName, onClose, onSaved }: {
  party?: Party; type: PartyType; initialName?: string; onClose: () => void; onSaved?: (p: Party) => void;
}) {
  const { toast, shop } = useApp();
  const [f, setF] = useState({
    name: party?.name ?? initialName ?? '',
    phone: party?.phone ?? '',
    area: party?.area ?? '',
    address: party?.address ?? '',
    opening: party ? String(party.openingPaisa / 100 || '') : '',
    limit: party ? String(party.creditLimitPaisa / 100 || '') : '',
    disc: party ? String(party.defaultDiscountPct || '') : String(shop.defaultDiscountPct || ''),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    if (!f.name.trim()) { toast(t('Name is required'), 'err'); return; }
    const clash = (await db.parties.toArray()).find(
      (p) => !p.deleted && p.type === type && p.id !== party?.id && p.name.trim().toLowerCase() === f.name.trim().toLowerCase(),
    );
    if (clash) { toast(type === 'customer' ? t('A customer named "{name}" already exists', { name: clash.name }) : t('A supplier named "{name}" already exists', { name: clash.name }), 'err'); return; }
    const saved = await db.put<Party>('parties', {
      id: party?.id ?? uuid(), type, name: f.name.trim(), address: f.address.trim(), phone: f.phone.trim(), area: f.area.trim(),
      openingPaisa: parseRupees(f.opening), creditLimitPaisa: parseRupees(f.limit),
      defaultDiscountPct: Math.min(100, Math.max(0, Number(f.disc) || 0)),
    });
    toast(type === 'customer' ? t('Customer saved') : t('Supplier saved'), 'ok');
    onSaved?.(saved);
    onClose();
  };

  return (
    <Modal title={type === 'customer' ? (party ? t('Edit customer') : t('New customer')) : (party ? t('Edit supplier') : t('New supplier'))} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{t('Cancel')}</button>
      <button className="btn primary" onClick={save}>{type === 'customer' ? t('Save customer') : t('Save supplier')}</button>
    </>}>
      <div className="form-grid">
        <Field label={t('Name *')} className="span2"><input type="text" value={f.name} onChange={set('name')} autoFocus placeholder={type === 'customer' ? t('e.g. Harris Auto Sham Kot.Xii') : ''} /></Field>
        <Field label={t('Phone / WhatsApp')}><input type="tel" value={f.phone} onChange={set('phone')} placeholder="0300 1234567" /></Field>
        <Field label={t('Area / city')}><input type="text" value={f.area} onChange={set('area')} /></Field>
        <Field label={t('Address')} className="span2"><input type="text" value={f.address} onChange={set('address')} /></Field>
        <Field label={t('Opening balance (Rs)')} hint={type === 'customer' ? t('Amount they already owe you (negative if you owe them)') : t('Amount you already owe them (negative if they owe you)')}>
          <input type="number" step="any" inputMode="decimal" value={f.opening} onChange={set('opening')} /></Field>
        {type === 'customer' && <>
          <Field label={t('Credit limit (Rs)')} hint={t('0 = no limit')}><input type="number" step="any" inputMode="decimal" value={f.limit} onChange={set('limit')} /></Field>
          <Field label={t('Usual discount %')} hint={t('Applied to new invoice lines')}><input type="number" step="any" inputMode="decimal" value={f.disc} onChange={set('disc')} /></Field>
        </>}
      </div>
    </Modal>
  );
}
