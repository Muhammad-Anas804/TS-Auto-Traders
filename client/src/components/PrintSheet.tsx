import type { Doc, Party, ShopSettings } from '../lib/types';
import { amountInWordsFor, fmt, fmtDate, fmtQty } from '../lib/money';
import { docTitleFor, partyDisplayFor } from '../lib/share';
import { tInvoice, tk } from '../i18n';

export interface PrintInfo {
  previousPaisa: number | null; // account balance before this document (null = walk-in / no account)
  paidPaisa: number;            // received/paid together with the document
  afterPaisa: number | null;
}

const PARTY_LABEL: Record<Doc['kind'], string> = {
  sale: tk('To: M/s'), sale_return: tk('From: M/s'), purchase: tk('From: M/s'), purchase_return: tk('To: M/s'),
};
const PARTY_LABEL_SHORT: Record<Doc['kind'], string> = {
  sale: tk('To:'), sale_return: tk('From:'), purchase: tk('From:'), purchase_return: tk('To:'),
};

export default function PrintSheet({ doc, shop, party, format, info }: {
  doc: Doc; shop: ShopSettings; party: Party | null; format: 'a4' | 'thermal'; info: PrintInfo;
}) {
  // The printed invoice has its own language setting, independent of the screen language.
  const lang = shop.invoiceLang ?? 'en';
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  const L = (key: string, params?: Record<string, string | number>) => tInvoice(lang, key, params); // i18n-ok: keys are marked with tk()/literals at the call sites
  const title = docTitleFor(lang, doc.kind).toUpperCase();
  const partyName = partyDisplayFor(lang, doc.partyName);
  const address = party?.address || doc.partyAddress;
  const phone = party?.phone || doc.partyPhone;
  const totalQty = doc.lines.reduce((sum, l) => sum + l.qty, 0);
  const extra = doc.extraDiscountPaisa;
  // The standard footer saved at setup follows the invoice language; a footer the shopkeeper wrote himself prints as typed.
  const footerText = shop.invoiceFooter === 'Thank you for your business.' ? L('Thank you for your business.') : shop.invoiceFooter;

  if (format === 'thermal') {
    return (
      <div className="sheet thermal" dir={dir}>
        <div className="shop">{shop.name}</div>
        {shop.address && <div className="c">{shop.address}</div>}
        {shop.phone && <div className="c">{L('Tel: {phone}', { phone: shop.phone })}</div>}
        <hr />
        <div className="t"><span>{docTitleFor(lang, doc.kind)} #{doc.no}</span><span>{fmtDate(doc.date)}</span></div>
        {doc.partyName && <div>{L(PARTY_LABEL_SHORT[doc.kind])} {partyName}</div>} {/* i18n-ok: table of tk() labels */}
        <hr />
        {doc.lines.map((l, i) => (
          <div className="li" key={l.id}>
            <div className="n">{i + 1}. {l.name}{l.bonus ? ` ${L('(free)')}` : ''}</div>
            <div className="q"><span>{fmtQty(l.qty)} x {fmt(l.ratePaisa)}{l.discountPaisa && !l.bonus ? ` -${fmt(l.discountPaisa)}` : ''}</span><span>{fmt(l.netPaisa)}</span></div>
          </div>
        ))}
        <hr />
        <div className="t"><span>{L('Items / Qty')}</span><span>{doc.lines.length} / {fmtQty(totalQty)}</span></div>
        <div className="t"><span>{L('Gross')}</span><span>{fmt(doc.grossPaisa)}</span></div>
        {doc.lineDiscountPaisa + extra > 0 && <div className="t"><span>{L('Discount')}</span><span>-{fmt(doc.lineDiscountPaisa + extra)}</span></div>}
        <div className="t big"><span>{L('NET')}</span><span>Rs {fmt(doc.netPaisa)}</span></div>
        {info.paidPaisa > 0 && <div className="t"><span>{L('Paid')}</span><span>{fmt(info.paidPaisa)}</span></div>}
        {info.afterPaisa !== null && <div className="t"><span>{L('Balance')}</span><span>{fmt(info.afterPaisa)}</span></div>}
        <hr />
        {doc.notes && <div>{doc.notes}</div>}
        <div className="c">{footerText}</div>
      </div>
    );
  }

  return (
    <div className="sheet a4" dir={dir}>
      <div className="s-head">
        <div className="shop">{shop.name}</div>
        {shop.address && <div className="addr">{shop.address}</div>}
        {(shop.phone || shop.email) && <div className="addr">{shop.phone && L('Tel: {phone}', { phone: shop.phone })}{shop.phone && shop.email && '   '}{shop.email && L('E-Mail: {email}', { email: shop.email })}</div>}
        {shop.taxNo && <div className="addr">{L('NTN / STRN: {no}', { no: shop.taxNo })}</div>}
      </div>
      <hr className="rule" />
      <div className="s-meta">
        <div>
          <div className="kv"><b>{L('Invoice No.')}</b><span>{doc.no}</span></div>
          <div className="kv"><b>{L('Invoice Date')}</b><span>{fmtDate(doc.date)}</span></div>
        </div>
        <div className="box">{title}</div>
      </div>
      <div className="s-parties">
        <div className="pbox">
          <div><b>{L(PARTY_LABEL[doc.kind])}</b> <span style={{ fontWeight: 700, marginInlineStart: 8 }}>{partyName}</span></div> {/* i18n-ok: table of tk() labels */}
          <div style={{ marginTop: 4 }}><b>{L('Address')}</b> <span style={{ marginInlineStart: 8 }}>{address}</span></div>
          <div style={{ marginTop: 4 }}><b>{L('Telephone')}</b> <span style={{ marginInlineStart: 8 }}>{phone}</span></div>
        </div>
        <div className="pbox ref">
          <b>{L('Terms of Payment')}</b><span>{doc.terms}</span>
          <b>{L('Purchase Order No.')}</b><span>{doc.poNo || doc.no}</span>
          <b>{L('Purchase Order Date')}</b><span>{fmtDate(doc.poDate || doc.date)}</span>
          <b>{L('Delivery Challan No.')}</b><span>{doc.challanNo || doc.no}</span>
          <b>{L('Delivery Challan Date')}</b><span>{fmtDate(doc.challanDate || doc.date)}</span>
        </div>
      </div>
      <table className="s-lines">
        <thead><tr>
          <th style={{ width: 34 }}>{L('S. No')}</th><th>{L('Particulars')}</th><th className="num" style={{ width: 70 }}>{L('Quantity')}</th>
          <th className="num" style={{ width: 70 }}>{L('Rate')}</th><th className="num" style={{ width: 90 }}>{L('Gross Amount')}</th>
          <th className="num" style={{ width: 72 }}>{L('Discount')}</th><th className="num" style={{ width: 92 }}>{L('Net Amount')}</th>
        </tr></thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={l.id} className={l.bonus ? 'free' : ''}>
              <td>{i + 1}</td>
              <td>{l.name}{l.bonus ? ` ${L('(free)')}` : ''}</td>
              <td className="num">{fmtQty(l.qty)} {l.unit}</td>
              <td className="num">{fmt(l.ratePaisa)}</td>
              <td className="num">{fmt(l.grossPaisa)}</td>
              <td className="num">{fmt(l.discountPaisa)}</td>
              <td className="num">{fmt(l.netPaisa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="s-foot">
        <div>
          <div className="words">{amountInWordsFor(lang, doc.netPaisa)}</div>
          {doc.notes && <div className="s-note"><b>{L('Note:')}</b> {doc.notes}</div>}
          {footerText && <div className="s-note">{footerText}</div>}
        </div>
        <div className="s-tot">
          <div className="t"><span>{L('Total quantity')}</span><span>{fmtQty(totalQty)}</span></div>
          <div className="t"><span>{L('Gross amount')}</span><span>{fmt(doc.grossPaisa)}</span></div>
          <div className="t"><span>{L('Discount')}</span><span>{fmt(doc.lineDiscountPaisa)}</span></div>
          {extra > 0 && <div className="t"><span>{L('Extra discount')}</span><span>{fmt(extra)}</span></div>}
          <div className="t net"><span>{L('Net amount')}</span><span>{fmt(doc.netPaisa)}</span></div>
          {info.previousPaisa !== null && <>
            <div className="t"><span>{L('Previous balance')}</span><span>{fmt(info.previousPaisa)}</span></div>
            {info.paidPaisa > 0 && <div className="t"><span>{L('Received now')}</span><span>{fmt(info.paidPaisa)}</span></div>}
            <div className="t"><b>{L('Balance after')}</b><b>{fmt(info.afterPaisa ?? 0)}</b></div>
          </>}
        </div>
      </div>
      <div className="s-sign"><div>{L('Prepared by')}</div><div>{L('Checked by')}</div><div>{L('Received by')}</div></div>
    </div>
  );
}
