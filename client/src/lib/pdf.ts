import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Doc, Party, ShopSettings } from './types';
import PrintSheet, { type PrintInfo } from '../components/PrintSheet';

/**
 * Turns an invoice into a real A4 PDF file (always A4, whatever paper the screen shows), so it can be sent on WhatsApp.
 * The invoice is drawn off-screen with the same PrintSheet used for printing, photographed by the browser
 * (so Urdu and English both look exactly as printed), and placed on A4 pages. Long invoices continue on more pages,
 * and a page never cuts through the middle of a row.
 * The two libraries are loaded only when this is used, so the rest of the app stays light.
 */
export async function invoicePdf(doc: Doc, shop: ShopSettings, party: Party | null, info: PrintInfo): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;background:#fff;';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(PrintSheet, { doc, shop, party, format: 'a4', info })));
    if (document.fonts?.ready) await document.fonts.ready;
    const sheet = host.querySelector<HTMLElement>('.sheet');
    if (!sheet) throw new Error('Invoice not drawn'); // i18n-ok: internal, never shown

    sheet.style.minHeight = '0';                        // the on-screen sheet is at least one page tall; the PDF should be as tall as its content
    sheet.style.boxShadow = 'none';

    // Where a page may end: after a table row, or before the totals and signature blocks.
    const top0 = sheet.getBoundingClientRect().top;
    const cssW = sheet.offsetWidth;
    const cssH = sheet.offsetHeight;
    const breaks: number[] = [];
    sheet.querySelectorAll('tbody tr').forEach((r) => breaks.push(r.getBoundingClientRect().bottom - top0));
    sheet.querySelectorAll('.s-foot, .s-sign').forEach((r) => breaks.push(r.getBoundingClientRect().top - top0));
    breaks.sort((a, b) => a - b);

    const scale = 2;
    const canvas = await html2canvas(sheet, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const pageW = 210, pageH = 297;
    const pxPerMm = cssW / pageW;
    const gapMm = 8;                                    // blank space above and below on pages after the first
    const firstH = pageH * pxPerMm;                     // the first page already has the sheet's own top padding
    const nextH = (pageH - gapMm * 2) * pxPerMm;

    let start = 0;
    let page = 0;
    while (start < cssH - 1) {
      const room = page === 0 ? firstH : nextH;
      let end = start + room;
      if (end >= cssH) end = cssH;
      else {
        const fit = breaks.filter((b) => b > start + 40 && b <= end).pop();
        if (fit) end = fit;
      }
      const sy = Math.round(start * scale);
      const sh = Math.max(1, Math.min(canvas.height - sy, Math.round((end - start) * scale)));
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = sh;
      const ctx = part.getContext('2d');
      if (!ctx) throw new Error('Canvas not available'); // i18n-ok: internal, never shown
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, part.width, part.height);
      ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
      if (page > 0) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 0, page === 0 ? 0 : gapMm, pageW, (sh / scale) / pxPerMm);
      start = end;
      page += 1;
      if (page > 30) break;                             // safety stop
    }
    return pdf.output('blob');
  } finally {
    root.unmount();
    host.remove();
  }
}

/** A safe file name such as "Sale-Invoice-A-0012.pdf". */
export function invoiceFileName(doc: Doc): string {
  const base = `${doc.kind.replace('_', '-')}-${doc.no}`.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${base}.pdf`;
}
