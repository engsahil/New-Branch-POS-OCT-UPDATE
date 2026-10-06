/**
 * ESC/POS command encoding for common Epson-compatible thermal printers.
 *
 * Text stays as printer-native characters (crisp, not rasterised). The only
 * raster work is the already-uploaded logo, converted with the browser's
 * native canvas at the printer's dot resolution. No PDF/image package or
 * backend is used.
 */

import type { KitchenReceiptModel, ReceiptModel, ReceiptWidth } from './receiptService';
import { receiptOrderTypeLabel } from '@/utils/receipt';
import { formatMoney } from '@/utils/currency';
import { formatPaymentMethod } from '@/utils/payment';

export const COLUMNS: Record<ReceiptWidth, number> = {
  '58mm': 32,
  '80mm': 48,
};

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const THERMAL_DPI = 203;

export const CMD = {
  INIT: [ESC, 0x40],
  ALIGN_LEFT: [ESC, 0x61, 0],
  ALIGN_CENTER: [ESC, 0x61, 1],
  ALIGN_RIGHT: [ESC, 0x61, 2],
  BOLD_ON: [ESC, 0x45, 1],
  BOLD_OFF: [ESC, 0x45, 0],
  SIZE_NORMAL: [GS, 0x21, 0x00],
  SIZE_DOUBLE: [GS, 0x21, 0x11],
  /** Partial cut with a one-dot advance; each text line already ends in LF. */
  CUT: [GS, 0x56, 66, 0x01],
  feed: (n: number) => [ESC, 0x64, n],
} as const;

export function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    const replacement =
      (
        {
          '\u2018': "'",
          '\u2019': "'",
          '\u201c': '"',
          '\u201d': '"',
          '\u2013': '-',
          '\u2014': '-',
          '\u2026': '...',
          '\u00a0': ' ',
          '\u00b7': '-',
          '\u20a8': 'Rs.',
          '\u00d7': 'x',
        } as Record<string, string>
      )[char] ?? '';
    for (const replacementChar of replacement) {
      bytes.push(replacementChar.charCodeAt(0));
    }
  }
  return bytes;
}

/** Word-wrap and hard-split overlong words so no text is lost at the edge. */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  const normalized = text.replace(/\r\n?/g, '\n');

  for (const paragraph of normalized.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (word.length > width) {
        if (current) {
          lines.push(current);
          current = '';
        }
        let rest = word;
        while (rest.length > width) {
          lines.push(rest.slice(0, width));
          rest = rest.slice(width);
        }
        current = rest;
      } else if (current === '') {
        current = word;
      } else if (current.length + 1 + word.length <= width) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

/** Two columns with the right-hand amount protected from a long label. */
export function twoColumns(left: string, right: string, width: number): string {
  if (right.length >= width) return right.slice(0, width).padStart(width);
  const space = width - right.length;
  const trimmedLeft = left.length > space - 1 ? left.slice(0, space - 1) : left;
  return trimmedLeft + ' '.repeat(width - trimmedLeft.length - right.length) + right;
}

export function centre(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const pad = Math.floor((width - text.length) / 2);
  return ' '.repeat(pad) + text;
}

function itemColumns(width: number, model: ReceiptModel) {
  const digitLength = (value: number) => String(Math.abs(value)).length;
  const quantity = Math.min(
    width >= 48 ? 6 : 4,
    Math.max(3, ...model.lines.map((line) => digitLength(line.quantity))),
  );
  const maxPrice = Math.max(
    0,
    ...model.lines.map((line) => formatMoney(line.unitPrice, { withSymbol: false }).length),
  );
  const maxAmount = Math.max(
    0,
    ...model.lines.map((line) => formatMoney(line.lineTotal, { withSymbol: false }).length),
  );
  const price = Math.min(width >= 48 ? 14 : 9, Math.max(width >= 48 ? 9 : 6, maxPrice));
  const amount = Math.min(width >= 48 ? 16 : 10, Math.max(width >= 48 ? 10 : 7, maxAmount));
  const name = Math.max(1, width - quantity - price - amount - 3);
  return { quantity, price, amount, name };
}

function itemRowLines(
  label: string,
  quantity: number,
  unitPrice: number,
  lineTotal: number,
  columns: ReturnType<typeof itemColumns>,
): string[] {
  const nameLines = wrapText(label, columns.name);
  const quantityLines = wrapText(String(quantity), columns.quantity);
  const priceLines = wrapText(
    formatMoney(unitPrice, { withSymbol: false }),
    columns.price,
  );
  const amountLines = wrapText(
    formatMoney(lineTotal, { withSymbol: false }),
    columns.amount,
  );
  const rows = Math.max(
    nameLines.length,
    quantityLines.length,
    priceLines.length,
    amountLines.length,
  );

  return Array.from({ length: rows }, (_, index) => {
    const name = (nameLines[index] ?? '').padEnd(columns.name);
    const quantityText = (quantityLines[index] ?? '').padStart(columns.quantity);
    const price = (priceLines[index] ?? '').padStart(columns.price);
    const amount = (amountLines[index] ?? '').padStart(columns.amount);
    return `${name} ${quantityText} ${price} ${amount}`;
  });
}

function pairLines(label: string, value: string, width: number): string[] {
  if (value.length > Math.max(4, width - label.length - 1)) {
    return [label, ...wrapText(`  ${value}`, width)];
  }
  return [twoColumns(label, value, width)];
}

function customerTextLines(model: ReceiptModel, width: number): string[] {
  const columns = itemColumns(width, model);
  const out: string[] = [];
  const divider = '-'.repeat(width);
  const money = (value: number) => formatMoney(value, { withSymbol: false });

  if (model.header.logo?.dataUrl.startsWith('data:image/')) {
    out.push(centre('[LOGO IMAGE]', width));
  }
  if (model.header.name) {
    for (const line of wrapText(model.header.name.toUpperCase(), Math.floor(width / 2))) {
      out.push(centre(line, width));
    }
  }
  for (const value of [
    model.header.address,
    model.header.phone,
    model.header.email,
    model.header.receiptInfo,
  ]) {
    if (!value) continue;
    for (const line of wrapText(value, width)) out.push(centre(line, width));
  }

  out.push(divider);
  out.push(...pairLines('Order', `#${model.orderNumber}`, width));
  out.push(...pairLines('Type', receiptOrderTypeLabel(model.orderType), width));
  if (model.tableLabel) out.push(...pairLines('Table', model.tableLabel, width));
  if (model.customerName) out.push(...pairLines('Customer', model.customerName, width));
  if (model.customerPhone) out.push(...pairLines('Phone', model.customerPhone, width));
  if (model.deliveryAddress) {
    for (const line of wrapText(`Address: ${model.deliveryAddress}`, width)) out.push(line);
  }
  out.push(...pairLines('Date', `${model.date} ${model.time}`, width));
  out.push(divider);

  out.push(
    'Item'.padEnd(columns.name) +
      ' ' +
      'Qty'.padStart(columns.quantity) +
      ' ' +
      'Price'.padStart(columns.price) +
      ' ' +
      'Amount'.padStart(columns.amount),
  );
  out.push(divider);

  for (const item of model.lines) {
    const label =
      item.name +
      (item.sizeLabel ? ` (${item.sizeLabel})` : '') +
      (item.isDeal ? ' [DEAL]' : '');
    out.push(...itemRowLines(label, item.quantity, item.unitPrice, item.lineTotal, columns));

    for (const topping of item.toppings) {
      for (const line of wrapText(`  + ${topping.name}${topping.price ? ` (${money(topping.price)})` : ''}`, width)) {
        out.push(line);
      }
    }
    for (const addOn of item.addOns) {
      for (const line of wrapText(`  + ${addOn.name}${addOn.price ? ` (${money(addOn.price)})` : ''}`, width)) {
        out.push(line);
      }
    }
    for (const content of item.dealContents) {
      for (const line of wrapText(`  - ${content}`, width)) out.push(line);
    }
    if (item.note) {
      for (const line of wrapText(`  Note: ${item.note}`, width)) out.push(line);
    }
  }

  out.push(divider);
  out.push(...pairLines('Subtotal', formatMoney(model.subtotal), width));
  if (model.discountTotal > 0) {
    out.push(...pairLines('Discount', `-${formatMoney(model.discountTotal)}`, width));
  }
  if (model.savingsTotal > 0) {
    out.push(...pairLines('Deal savings', `-${formatMoney(model.savingsTotal)}`, width));
  }
  if (model.taxTotal > 0) {
    const label = model.taxPercent > 0 ? `Tax (${model.taxPercent}%)` : 'Tax';
    out.push(...pairLines(label, formatMoney(model.taxTotal), width));
  }
  out.push(divider);
  out.push(`TOTAL ${formatMoney(model.grandTotal)}`);
  if (model.amountPaid != null) {
    out.push(...pairLines('Payment method', formatPaymentMethod(model.paymentMethod), width));
    out.push(...pairLines('Paid', formatMoney(model.amountPaid), width));
  }
  if (model.changeDue != null && model.changeDue > 0) {
    out.push(...pairLines('Change', formatMoney(model.changeDue), width));
  }
  out.push(divider);

  out.push(centre(`${model.itemCount} item${model.itemCount === 1 ? '' : 's'}`, width));
  if (model.deliveryNotes) {
    for (const line of wrapText(`Delivery instructions: ${model.deliveryNotes}`, width)) out.push(line);
  }
  if (model.note) {
    for (const line of wrapText(`Note: ${model.note}`, width)) out.push(line);
  }
  if (model.footer) {
    for (const line of wrapText(model.footer, width)) out.push(centre(line, width));
  }

  return out;
}

export function renderPlainText(model: ReceiptModel, width: ReceiptWidth): string {
  return customerTextLines(model, COLUMNS[width]).join('\n');
}

function kitchenTextLines(model: KitchenReceiptModel, width: number): string[] {
  const out: string[] = [centre('KITCHEN', width), '-'.repeat(width)];
  out.push(...pairLines('Order', `#${model.orderNumber}`, width));
  out.push(...pairLines('Type', receiptOrderTypeLabel(model.orderType), width));
  if (model.tableLabel) out.push(...pairLines('Table', model.tableLabel, width));
  out.push(...pairLines('Time', model.time, width));
  out.push('-'.repeat(width));

  for (const item of model.lines) {
    const label = `${item.name}${item.sizeLabel ? ` (${item.sizeLabel})` : ''}${item.isDeal ? ' [DEAL]' : ''}`;
    const prefix = `${item.quantity}x `;
    const labelLines = wrapText(label, Math.max(1, width - prefix.length));
    out.push(`${prefix}${labelLines[0] ?? ''}`);
    for (const line of labelLines.slice(1)) out.push(`  ${line}`);
    for (const topping of item.toppings) {
      for (const line of wrapText(`  Topping: ${topping.name}`, width)) out.push(line);
    }
    for (const addOn of item.addOns) {
      for (const line of wrapText(`  Add-on: ${addOn.name}`, width)) out.push(line);
    }
    for (const content of item.dealContents) {
      for (const line of wrapText(`  - ${content}`, width)) out.push(line);
    }
    if (item.note) {
      for (const line of wrapText(`  Note: ${item.note}`, width)) out.push(line);
    }
  }

  if (model.deliveryNotes) {
    for (const line of wrapText(`Delivery instructions: ${model.deliveryNotes}`, width)) out.push(line);
  }
  if (model.note) {
    for (const line of wrapText(`Order note: ${model.note}`, width)) out.push(line);
  }
  return out;
}

export function renderKitchenPlainText(
  model: KitchenReceiptModel,
  width: ReceiptWidth,
): string {
  return kitchenTextLines(model, COLUMNS[width]).join('\n');
}

interface RasterLogo {
  bytes: number[];
}

/**
 * Convert the stored logo data URL to a one-bit ESC/POS raster at printer
 * resolution. It is only reduced (never enlarged), centered, aspect-preserved,
 * composited on white, and bounded to a small dot canvas.
 */
async function rasteriseLogo(
  model: ReceiptModel,
  width: ReceiptWidth,
): Promise<RasterLogo | null> {
  const dataUrl = model.header.logo?.dataUrl;
  if (!dataUrl?.startsWith('data:image/')) return null;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

  try {
    const image = new Image();
    image.src = dataUrl;
    if (typeof image.decode === 'function') await image.decode();
    else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Logo image could not be decoded.'));
      });
    }

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) return null;

    const maxWidthMm = width === '80mm' ? 54 : 42;
    const maxHeightMm = width === '80mm' ? 24 : 20;
    const maxWidthDots = Math.floor((maxWidthMm * THERMAL_DPI) / 25.4);
    const maxHeightDots = Math.floor((maxHeightMm * THERMAL_DPI) / 25.4);
    const scale = Math.min(
      1,
      maxWidthDots / sourceWidth,
      maxHeightDots / sourceHeight,
    );
    const pixelWidth = Math.max(1, Math.floor(sourceWidth * scale));
    const pixelHeight = Math.max(1, Math.floor(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pixelWidth, pixelHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight);

    const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight).data;
    const rowBytes = Math.ceil(pixelWidth / 8);
    const raster = new Array<number>(rowBytes * pixelHeight).fill(0);
    for (let y = 0; y < pixelHeight; y += 1) {
      for (let x = 0; x < pixelWidth; x += 1) {
        const offset = (y * pixelWidth + x) * 4;
        const luminance =
          pixels[offset]! * 0.299 +
          pixels[offset + 1]! * 0.587 +
          pixels[offset + 2]! * 0.114;
        if (luminance < 160) {
          raster[y * rowBytes + Math.floor(x / 8)]! |= 0x80 >> (x % 8);
        }
      }
    }

    const xL = rowBytes & 0xff;
    const xH = (rowBytes >> 8) & 0xff;
    const yL = pixelHeight & 0xff;
    const yH = (pixelHeight >> 8) & 0xff;
    return {
      bytes: [GS, 0x76, 0x30, 0x00, xL, xH, yL, yH, ...raster],
    };
  } catch {
    // The text receipt remains valid if an old/corrupt logo cannot decode.
    return null;
  }
}

function addLogoCommand(bytes: number[], logo: RasterLogo | null): void {
  if (logo) bytes.push(...logo.bytes);
}

function encodeCustomer(
  model: ReceiptModel,
  width: ReceiptWidth,
  logo: RasterLogo | null,
): Uint8Array {
  const cols = COLUMNS[width];
  const columns = itemColumns(cols, model);
  const bytes: number[] = [];
  const push = (...values: (number | readonly number[])[]) => {
    for (const value of values) {
      if (typeof value === 'number') bytes.push(value);
      else bytes.push(...value);
    }
  };
  const line = (text = '') => push(encodeText(text), LF);
  push(CMD.INIT, CMD.ALIGN_CENTER);
  addLogoCommand(bytes, logo);

  if (model.header.name) {
    push(CMD.BOLD_ON, CMD.SIZE_DOUBLE);
    for (const nameLine of wrapText(model.header.name.toUpperCase(), Math.floor(cols / 2))) {
      line(nameLine);
    }
    push(CMD.SIZE_NORMAL, CMD.BOLD_OFF);
  }

  for (const value of [
    model.header.address,
    model.header.phone,
    model.header.email,
    model.header.receiptInfo,
  ]) {
    if (!value) continue;
    for (const wrapped of wrapText(value, cols)) line(wrapped);
  }

  push(CMD.ALIGN_LEFT);
  line('-'.repeat(cols));
  const metadata: [string, string][] = [
    ['Order', `#${model.orderNumber}`],
    ['Type', receiptOrderTypeLabel(model.orderType)],
    ...(model.tableLabel ? [['Table', model.tableLabel] as [string, string]] : []),
    ...(model.customerName ? [['Customer', model.customerName] as [string, string]] : []),
    ...(model.customerPhone ? [['Phone', model.customerPhone] as [string, string]] : []),
  ];
  for (const [label, value] of metadata) {
    const wrapped = pairLines(label, value, cols);
    wrapped.forEach(line);
  }
  if (model.deliveryAddress) {
    const wrapped = wrapText(`Address: ${model.deliveryAddress}`, cols);
    wrapped.forEach(line);
  }
  const dateLines = pairLines('Date', `${model.date} ${model.time}`, cols);
  dateLines.forEach(line);
  line('-'.repeat(cols));

  push(CMD.BOLD_ON);
  line(
    'Item'.padEnd(columns.name) +
      ' ' +
      'Qty'.padStart(columns.quantity) +
      ' ' +
      'Price'.padStart(columns.price) +
      ' ' +
      'Amount'.padStart(columns.amount),
  );
  push(CMD.BOLD_OFF);
  line('-'.repeat(cols));

  for (const item of model.lines) {
    const label =
      item.name +
      (item.sizeLabel ? ` (${item.sizeLabel})` : '') +
      (item.isDeal ? ' [DEAL]' : '');
    const itemLines = itemRowLines(label, item.quantity, item.unitPrice, item.lineTotal, columns);
    push(CMD.BOLD_ON);
    itemLines.forEach(line);
    push(CMD.BOLD_OFF);

    for (const topping of item.toppings) {
      const wrapped = wrapText(
        `  + ${topping.name}${topping.price ? ` (${formatMoney(topping.price, { withSymbol: false })})` : ''}`,
        cols,
      );
      wrapped.forEach(line);
    }
    for (const addOn of item.addOns) {
      const wrapped = wrapText(
        `  + ${addOn.name}${addOn.price ? ` (${formatMoney(addOn.price, { withSymbol: false })})` : ''}`,
        cols,
      );
      wrapped.forEach(line);
    }
    for (const content of item.dealContents) {
      const wrapped = wrapText(`  - ${content}`, cols);
      wrapped.forEach(line);
    }
    if (item.note) {
      const wrapped = wrapText(`  Note: ${item.note}`, cols);
      wrapped.forEach(line);
    }
  }

  line('-'.repeat(cols));
  const moneyPairs: [string, string][] = [
    ['Subtotal', formatMoney(model.subtotal)],
    ...(model.discountTotal > 0
      ? [['Discount', `-${formatMoney(model.discountTotal)}`] as [string, string]]
      : []),
    ...(model.savingsTotal > 0
      ? [['Deal savings', `-${formatMoney(model.savingsTotal)}`] as [string, string]]
      : []),
    ...(model.taxTotal > 0
      ? [[model.taxPercent > 0 ? `Tax (${model.taxPercent}%)` : 'Tax', formatMoney(model.taxTotal)] as [string, string]]
      : []),
  ];
  for (const [label, value] of moneyPairs) {
    const wrapped = pairLines(label, value, cols);
    wrapped.forEach(line);
  }

  line('-'.repeat(cols));
  push(CMD.BOLD_ON, CMD.SIZE_DOUBLE, CMD.ALIGN_LEFT);
  const doubleWidthColumns = Math.floor(cols / 2);
  const totalAmount = formatMoney(model.grandTotal);
  const totalLabel = `TOTAL ${totalAmount}`;
  if (totalLabel.length <= doubleWidthColumns) {
    line(totalLabel);
  } else {
    // Keep the full money value together at 58mm instead of splitting cents
    // across two doubled-width lines. The formatted amount fits by itself.
    line('TOTAL');
    wrapText(totalAmount, doubleWidthColumns).forEach(line);
  }
  push(CMD.SIZE_NORMAL, CMD.BOLD_OFF);

  if (model.amountPaid != null) {
    const methodLines = pairLines('Payment method', formatPaymentMethod(model.paymentMethod), cols);
    methodLines.forEach(line);
    const paidLines = pairLines('Paid', formatMoney(model.amountPaid), cols);
    paidLines.forEach(line);
  }
  if (model.changeDue != null && model.changeDue > 0) {
    const changeLines = pairLines('Change', formatMoney(model.changeDue), cols);
    changeLines.forEach(line);
  }

  push(CMD.ALIGN_CENTER);
  line('-'.repeat(cols));
  line(`${model.itemCount} item${model.itemCount === 1 ? '' : 's'}`);
  if (model.deliveryNotes) {
    const wrapped = wrapText(`Delivery instructions: ${model.deliveryNotes}`, cols);
    wrapped.forEach(line);
  }
  if (model.note) {
    const wrapped = wrapText(`Note: ${model.note}`, cols);
    wrapped.forEach(line);
  }
  if (model.footer) {
    const wrapped = wrapText(model.footer, cols);
    wrapped.forEach(line);
  }

  // `line()` has already advanced past the final text. This is the only
  // terminal feed/cut operation: no fixed-height page, trailing blank block,
  // or redundant full-line feed before the partial cut.
  push(CMD.CUT);
  return new Uint8Array(bytes);
}

/** Synchronous text-only encoder retained for diagnostics and environments without canvas. */
export function encodeReceipt(model: ReceiptModel, width: ReceiptWidth): Uint8Array {
  return encodeCustomer(model, width, null);
}

/** Customer direct-print encoder: adds the existing logo when it can be decoded. */
export async function encodeReceiptWithLogo(
  model: ReceiptModel,
  width: ReceiptWidth,
): Promise<Uint8Array> {
  return encodeCustomer(model, width, await rasteriseLogo(model, width));
}

function encodeKitchen(model: KitchenReceiptModel, width: ReceiptWidth): Uint8Array {
  const cols = COLUMNS[width];
  const bytes: number[] = [];
  const push = (...values: (number | readonly number[])[]) => {
    for (const value of values) {
      if (typeof value === 'number') bytes.push(value);
      else bytes.push(...value);
    }
  };
  const line = (text = '') => push(encodeText(text), LF);

  push(CMD.INIT, CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.SIZE_DOUBLE);
  for (const titleLine of wrapText('KITCHEN', Math.floor(cols / 2))) line(titleLine);
  push(CMD.SIZE_NORMAL, CMD.BOLD_OFF, CMD.ALIGN_LEFT);
  line('-'.repeat(cols));
  pairLines('Order', `#${model.orderNumber}`, cols).forEach(line);
  pairLines('Type', receiptOrderTypeLabel(model.orderType), cols).forEach(line);
  if (model.tableLabel) pairLines('Table', model.tableLabel, cols).forEach(line);
  pairLines('Time', model.time, cols).forEach(line);
  line('-'.repeat(cols));

  for (const item of model.lines) {
    const label =
      `${item.name}${item.sizeLabel ? ` (${item.sizeLabel})` : ''}` +
      (item.isDeal ? ' [DEAL]' : '');
    const prefix = `${item.quantity}x `;
    const nameLines = wrapText(label, Math.max(1, cols - prefix.length));
    push(CMD.BOLD_ON);
    line(`${prefix}${nameLines[0] ?? ''}`);
    nameLines.slice(1).forEach((extra) => line(`  ${extra}`));
    push(CMD.BOLD_OFF);

    for (const topping of item.toppings) {
      wrapText(`  Topping: ${topping.name}`, cols).forEach(line);
    }
    for (const addOn of item.addOns) {
      wrapText(`  Add-on: ${addOn.name}`, cols).forEach(line);
    }
    for (const content of item.dealContents) {
      wrapText(`  - ${content}`, cols).forEach(line);
    }
    if (item.note) wrapText(`  Note: ${item.note}`, cols).forEach(line);
  }

  if (model.deliveryNotes) {
    wrapText(`Delivery instructions: ${model.deliveryNotes}`, cols).forEach(line);
  }
  if (model.note) wrapText(`Order note: ${model.note}`, cols).forEach(line);

  push(CMD.CUT);
  return new Uint8Array(bytes);
}

export function encodeKitchenReceipt(
  model: KitchenReceiptModel,
  width: ReceiptWidth,
): Uint8Array {
  return encodeKitchen(model, width);
}
