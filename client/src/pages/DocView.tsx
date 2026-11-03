import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { voidDoc } from '../lib/docs';
import { buildLedger } from '../lib/ledger';
import { fmt } from '../lib/money';
import { t } from '../i18n';
import { docTitle, waLink } from '../lib/share';
import { invoiceFileName, invoicePdf } from '../lib/pdf';
import { useApp } from '../state';
import { PageHead, useConfirm } from '../components/ui';
import PrintSheet, { type PrintInfo } from '../components/PrintSheet';

export default function DocView() {
  const { id } = useParams();
  const [search, setSearch] = useSearchParams();
  const nav = useNavigate();
  const { shop, can, toast } = useApp();
  const { ask, dialog } = useConfirm();
  const doc = useLiveQuery(async () => (await db.docs.get(id!)) ?? null, [id]);
  const party = useLiveQuery(async () => (doc?.partyId ? (await db.parties.get(doc.partyId)) ?? null : null), [doc?.partyId], null);
  const [format, setFormat] = useState<'a4' | 'thermal'>('a4');
  const printed = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void db.getMeta<'a4' | 'thermal'>('printFormat', 'a4').then(setFormat); }, []);
  const changeFormat = (f: 'a4' | 'thermal') => { setFormat(f); void db.setMeta('printFormat', f); };

  const info = useLiveQuery(async (): Promise<PrintInfo | null> => {
    if (!doc) return null;
    const pays = doc.id ? (await db.payments.where('docId').equals(doc.id).toArray()).filter((p) => !p.deleted) : [];
    const paid = pays.reduce((sum, p) => sum + p.amountPaisa, 0);
    if (!party) return { previousPaisa: null, paidPaisa: paid, afterPaisa: null };
    const rows = await buildLedger(db, party);
    const idx = rows.findIndex((r) => r.ref === doc.no && r.type === doc.kind);
    if (idx < 0) return { previousPaisa: null, paidPaisa: paid, afterPaisa: null };
    const r = rows[idx];
    const prev = r.balance - r.debit + r.credit;
    return { previousPaisa: prev, paidPaisa: paid, afterPaisa: r.balance - paid };
  }, [doc?.id, doc?.updatedAt, party?.id]);

  // "Save & print" lands here with ?print=1: open the print dialog once the sheet is on screen.
  useEffect(() => {
    if (search.get('print') === '1' && doc && info && !printed.current) {
      printed.current = true;
      const timer = setTimeout(() => { window.print(); setSearch({}, { replace: true }); }, 400);
      return () => clearTimeout(timer);
    }
  }, [search, doc, info, setSearch]);

  if (doc === undefined) return <div className="card">{t('Loading…')}</div>;
  if (!doc || doc.deleted) return <div className="card"><h2>{t('Not found')}</h2><Link to="/sales">{t('Back to sales')}</Link></div>;

  const title = docTitle(doc.kind);
  const listTo = doc.kind === 'sale' ? '/sales' : doc.kind === 'purchase' ? '/purchases' : '/returns';
  const phone = party?.phone ?? doc.partyPhone;

  const doVoid = async () => {
    if (await ask(t('Cancel {title} {no}?\n\nThe stock and the customer account will be put back as if it never happened. The record stays for your audit trail.', { title, no: doc.no }), { ok: t('Cancel this document'), danger: true })) {
      await voidDoc(db, doc.id);
      toast(t('{no} cancelled', { no: doc.no }));
    }
  };
  const balanceNow = info?.afterPaisa ?? undefined;

  /** Sends the invoice as a PDF file. Phones and Windows open the share list (choose WhatsApp, then the customer);
   *  where the browser cannot share files, the PDF is saved and the customer's chat is opened to attach it. */
  const sendPdf = async () => {
    if (!info || busy) return;
    setBusy(true);
    try {
      const blob = await invoicePdf(doc, shop, party ?? null, info);
      const name = invoiceFileName(doc);
      const file = new File([blob], name, { type: 'application/pdf' });
      const short = `${shop.name}: ${title} ${doc.no}, Rs ${fmt(doc.netPaisa)}`;
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: short, text: short }); return; }
        catch (e) { if ((e as Error).name === 'AbortError') return; /* otherwise fall back to saving the file */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (await ask(t('The invoice PDF was saved in your Downloads folder. Open WhatsApp, then attach the PDF with the paperclip (or drag it into the chat).'), { ok: t('Open WhatsApp') })) {
        window.open(waLink(phone ?? '', short), '_blank', 'noreferrer');
      }
    } catch (e) {
      console.error(e);
      toast(t('Could not make the PDF. Use Print / Save PDF instead.'), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <style>{/* i18n-ok */`@page { size: ${format === 'a4' ? 'A4' : '80mm auto'}; margin: ${format === 'a4' ? '10mm' : '2mm'}; }`}</style>
      <PageHead title={t('{title} {no}', { title, no: doc.no })}>
        {doc.status === 'void' && <span className="badge bad">{t('Cancelled')}</span>}
        <button className="btn" onClick={() => nav(listTo)}>{t('← List')}</button>
        {can('sales.edit') && doc.status === 'active' && <Link className="btn" to={`/edit/${doc.id}`}>{t('Edit')}</Link>}
        {can('sales.void') && doc.status === 'active' && <button className="btn danger" onClick={doVoid}>{t('Cancel document')}</button>}
        <button className="btn" onClick={() => void sendPdf()} disabled={busy || !info}>{busy ? t('Making PDF…') : 'WhatsApp PDF'}</button>
        <select value={format} onChange={(e) => changeFormat(e.target.value as 'a4' | 'thermal')} style={{ width: 'auto' }} aria-label={t('Paper')}>
          <option value="a4">{t('A4 invoice')}</option><option value="thermal">{t('80mm receipt')}</option>
        </select>
        <button className="btn primary" onClick={() => window.print()}>{t('Print / Save PDF')}</button>
      </PageHead>
      {doc.status === 'void' && <div className="alert bad mb no-print">{t('This document is cancelled. It no longer affects stock or the account.')}</div>}
      <div className="sheet-wrap">
        {info && <PrintSheet doc={doc} shop={shop} party={party} format={format} info={info} />}
      </div>
      <p className="hint center no-print mt">{t('To save a PDF, choose "Save as PDF" as the printer. Net total: Rs {amount}.', { amount: fmt(doc.netPaisa) })}</p>
      {dialog}
    </>
  );
}
