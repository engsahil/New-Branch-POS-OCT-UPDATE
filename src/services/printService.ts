/**
 * Browser printing for 58mm and 80mm thermal receipts.
 *
 * Printing the application viewport (or appending a receipt into its
 * full-height document) lets the browser/driver inherit A4/Letter or viewport
 * dimensions. Instead, every job is rendered in a dedicated, receipt-only
 * iframe. Its CSS page is set to the physical paper width and the measured
 * content height, so no application shell, scroll container, or viewport
 * height can become part of the printed page.
 *
 * This still depends on the browser/printer driver accepting CSS custom page
 * sizes. For printers whose driver forces a fixed roll length, direct ESC/POS
 * printing is the reliable content-feed-and-cut path.
 */

import type { ReceiptWidth } from './receiptService';

const PAGE_STYLE_ID = 'thermal-page-size';
const FRAME_TITLE = 'Thermal receipt print document';
const MM_PER_PX = 25.4 / 96;
const FEED_TAIL_MM = 0.6;
const PRINT_COMPLETION_FALLBACK_MS = 30_000;
const IMAGE_LOAD_FALLBACK_MS = 5_000;

const WIDTH_MM: Record<ReceiptWidth, number> = {
  '58mm': 58,
  '80mm': 80,
};

/** Measured receipt height, rounded up to 0.1mm plus only a small safe tail. */
export function measureHeightMm(element: HTMLElement | null): number {
  if (!element) return 1;
  const px = Math.max(element.scrollHeight, element.getBoundingClientRect().height);
  const contentMm = Math.ceil(px * MM_PER_PX * 10) / 10;
  return Math.max(1, Math.round((contentMm + FEED_TAIL_MM) * 10) / 10);
}

/** Inject a valid, explicit two-dimension thermal page into the print document. */
export function applyPageSize(
  width: ReceiptWidth,
  heightMm: number,
  targetDocument: Document = document,
): void {
  targetDocument.getElementById(PAGE_STYLE_ID)?.remove();

  const safeHeight = Number.isFinite(heightMm) ? Math.max(1, heightMm) : 1;
  const style = targetDocument.createElement('style');
  style.id = PAGE_STYLE_ID;
  style.media = 'print';
  style.textContent = `@page { size: ${width} ${safeHeight}mm; margin: 0; }`;
  targetDocument.head.appendChild(style);
}

function createFrame(width: ReceiptWidth): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.title = FRAME_TITLE;
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.position = 'fixed';
  frame.style.left = '-10000px';
  frame.style.top = '0';
  frame.style.width = `${Math.ceil(WIDTH_MM[width] / MM_PER_PX)}px`;
  // The frame viewport itself is deliberately tiny; only the receipt's
  // measured document is paginated. There is no large iframe/page height.
  frame.style.height = '1px';
  frame.style.border = '0';
  frame.style.padding = '0';
  frame.style.margin = '0';
  frame.style.overflow = 'hidden';
  document.body.appendChild(frame);

  const printDocument = frame.contentDocument;
  if (!printDocument) {
    frame.remove();
    throw new Error('The browser could not create a receipt print document.');
  }

  printDocument.open();
  printDocument.write(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>',
  );
  printDocument.close();
  return frame;
}

function waitForStylesheet(link: HTMLLinkElement): Promise<void> {
  return new Promise((resolve) => {
    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      link.removeEventListener('load', finish);
      link.removeEventListener('error', finish);
      resolve();
    };
    link.addEventListener('load', finish, { once: true });
    link.addEventListener('error', finish, { once: true });
    timer = window.setTimeout(finish, IMAGE_LOAD_FALLBACK_MS);
  });
}

async function copyApplicationStyles(printDocument: Document): Promise<void> {
  const pending: Promise<void>[] = [];
  const sourceNodes = Array.from(
    document.head.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
      'style, link[rel~="stylesheet"]',
    ),
  );

  for (const source of sourceNodes) {
    if (source.id === PAGE_STYLE_ID) continue;

    if (source instanceof HTMLStyleElement) {
      printDocument.head.appendChild(source.cloneNode(true));
      continue;
    }

    const link = source.cloneNode(true) as HTMLLinkElement;
    // Resolve relative Vite/base-path asset URLs against the running app.
    link.href = source.href;
    // Styles are also needed for the pre-print content measurement. Their
    // own @media print rules remain scoped exactly as authored.
    link.media = 'all';
    const loaded = waitForStylesheet(link);
    printDocument.head.appendChild(link);
    pending.push(loaded);
  }

  await Promise.all(pending);
  if (printDocument.fonts?.ready) {
    await printDocument.fonts.ready;
  }
}

async function settleImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          let timer = 0;
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            image.removeEventListener('load', finish);
            image.removeEventListener('error', finish);
            if (image.naturalWidth === 0) image.remove();
            resolve();
          };

          image.addEventListener('load', finish, { once: true });
          image.addEventListener('error', finish, { once: true });
          timer = window.setTimeout(finish, IMAGE_LOAD_FALLBACK_MS);
          if (image.complete) finish();
        }),
    ),
  );

  await Promise.all(
    Array.from(root.querySelectorAll('img')).map(async (image) => {
      if (typeof image.decode !== 'function') return;
      try {
        await image.decode();
      } catch {
        image.remove();
      }
    }),
  );
}

function waitForPrintCompletion(printWindow: Window): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      printWindow.removeEventListener('afterprint', finish);
      resolve();
    };

    printWindow.addEventListener('afterprint', finish, { once: true });
    timer = window.setTimeout(finish, PRINT_COMPLETION_FALLBACK_MS);
  });
}

/**
 * Print one receipt in its own dynamically sized page/document. A missing
 * receipt is an error, never a request to print the whole application page.
 */
export async function printReceipt({
  width,
  container,
}: {
  width: ReceiptWidth;
  container: HTMLElement | null;
}): Promise<void> {
  if (!container) {
    throw new Error('The receipt is not ready to print. Reopen it and try again.');
  }

  const frame = createFrame(width);
  const printDocument = frame.contentDocument;
  const printWindow = frame.contentWindow;
  if (!printDocument || !printWindow) {
    frame.remove();
    throw new Error('The browser could not open the receipt print document.');
  }

  let keepFrameUntilAfterPrint = false;
  try {
    await copyApplicationStyles(printDocument);

    const root = printDocument.createElement('div');
    root.className = 'print-root';
    const clone = container.cloneNode(true) as HTMLElement;
    // A receipt clone can originate from a non-active preview tab. Printing
    // the selected node must not inherit that tab's inline display:none.
    clone.style.setProperty('display', 'block', 'important');
    root.appendChild(clone);
    printDocument.body.appendChild(root);

    await settleImages(root);
    // Let the copied stylesheet and final decoded image dimensions settle
    // before measuring. The only height in the print document is content.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));

    const receipt =
      clone.matches('[data-receipt-width]')
        ? clone
        : clone.querySelector<HTMLElement>('[data-receipt-width]');
    const heightMm = measureHeightMm(receipt ?? root);
    applyPageSize(width, heightMm, printDocument);

    const completed = waitForPrintCompletion(printWindow);
    printWindow.focus();
    printWindow.print();
    keepFrameUntilAfterPrint = true;

    await completed;
  } finally {
    // The timeout in waitForPrintCompletion is a fallback for browsers that
    // omit afterprint. Do not remove the frame while a print dialog is open.
    if (!keepFrameUntilAfterPrint) frame.remove();
    else window.setTimeout(() => frame.remove(), 0);
  }
}
