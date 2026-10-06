import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith('@/')
    ? path.join(root, 'src', request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

Module._extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  module._compile(output.outputText, filename);
};

const escpos = require(path.join(root, 'src/services/escpos.ts'));
const printService = require(path.join(root, 'src/services/printService.ts'));
const includesBytes = (bytes, sequence) => {
  outer: for (let index = 0; index <= bytes.length - sequence.length; index += 1) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (bytes[index + offset] !== sequence[offset]) continue outer;
    }
    return true;
  }
  return false;
};

const toppings = [{ name: 'Extra cheddar', price: 50 }];
const model = {
  header: {
    name: 'North Star Kitchen',
    logo: null,
    address: '1 Main Street',
    phone: '555-1000',
    email: 'hello@example.test',
    receiptInfo: 'Tax ID 123',
  },
  orderNumber: 'A-0101',
  orderId: 'order-101',
  date: '02/10/2026',
  time: '12:30 PM',
  lines: [
    {
      id: 'line-1',
      name: 'Extraordinary-Sandwich-Name-That-Does-Not-Fit-On-58mm-Paper',
      sizeLabel: 'Large',
      quantity: 12,
      unitPrice: 999999,
      lineTotal: 11999988,
      isDeal: false,
      dealContents: [],
      dealSavings: 0,
      toppings,
      addOns: [{ name: 'Garlic sauce', price: 25 }],
      note: 'No onions, sauce on the side',
      toppingTotal: 600,
      addOnTotal: 300,
    },
    {
      id: 'line-2',
      name: 'Family combo deal',
      sizeLabel: null,
      quantity: 1,
      unitPrice: 5000,
      lineTotal: 4500,
      isDeal: true,
      dealContents: ['2 x Burger (Large)', '1 x Fries (Small)'],
      dealSavings: 500,
      toppings: [],
      addOns: [],
      note: null,
      toppingTotal: 0,
      addOnTotal: 0,
    },
  ],
  subtotal: 12004488,
  taxTotal: 0,
  taxPercent: 0,
  savingsTotal: 500,
  grandTotal: 12004488,
  itemCount: 13,
  paymentMethod: 'cash',
  footer: 'Thank you for visiting',
  orderType: 'delivery',
  tableLabel: null,
  customerName: 'Avery Customer with an intentionally long name',
  customerPhone: '555-2000',
  deliveryAddress: '2 Second Street, Apartment 10, North District',
  deliveryNotes: 'Leave at front desk after calling',
  note: null,
  discountTotal: 0,
  amountPaid: 13000000,
  changeDue: 799512,
};
const kitchen = {
  orderNumber: model.orderNumber,
  orderId: model.orderId,
  date: model.date,
  time: model.time,
  orderType: model.orderType,
  tableLabel: model.tableLabel,
  customerName: model.customerName,
  customerPhone: model.customerPhone,
  deliveryAddress: model.deliveryAddress,
  deliveryNotes: model.deliveryNotes,
  note: 'Pack sauces separately',
  lines: model.lines,
  itemCount: model.itemCount,
};

for (const width of ['58mm', '80mm']) {
  const columns = escpos.COLUMNS[width];
  const customerText = escpos.renderPlainText(model, width);
  const kitchenText = escpos.renderKitchenPlainText(kitchen, width);
  const customerLines = customerText.split('\n');
  const kitchenLines = kitchenText.split('\n');

  assert.equal(columns, width === '58mm' ? 32 : 48);
  assert.ok(customerLines.every((line) => line.length <= columns), `${width} customer line fits`);
  assert.ok(kitchenLines.every((line) => line.length <= columns), `${width} kitchen line fits`);
  assert.match(customerText, /TOTAL Rs\. 120,044\.88/);
  const expectedNameLines = escpos.wrapText(
    'Extraordinary-Sandwich-Name-That-Does-Not-Fit-On-58mm-Paper (Large)',
    width === '58mm' ? 8 : 23,
  );
  for (const nameLine of expectedNameLines) {
    assert.ok(customerText.includes(nameLine), `${width} keeps wrapped item text “${nameLine}”`);
  }
  assert.match(customerText, /119,999\.88/);
  assert.match(customerText, /555-2000/);
  assert.match(customerText, /Tax ID 123/);
  assert.match(kitchenText, /13x|12x/);
  assert.ok(kitchenText.includes('Extraordinary-Sandwich-Name'));
  assert.ok(kitchenText.includes('per (Large)') || kitchenText.includes('Paper (Large)'));
  assert.doesNotMatch(kitchenText, /555-2000|Avery Customer|Second Street|Rs\.|Subtotal|TOTAL/);
  assert.ok(kitchenText.length < customerText.length, `${width} kitchen ticket is shorter than customer ticket`);

  const customerBytes = escpos.encodeReceipt(model, width);
  const kitchenBytes = escpos.encodeKitchenReceipt(kitchen, width);
  assert.deepEqual(Array.from(customerBytes.slice(0, 2)), [0x1b, 0x40]);
  assert.deepEqual(Array.from(customerBytes.slice(-4)), [0x1d, 0x56, 66, 1]);
  assert.deepEqual(Array.from(kitchenBytes.slice(0, 2)), [0x1b, 0x40]);
  assert.deepEqual(Array.from(kitchenBytes.slice(-4)), [0x1d, 0x56, 66, 1]);
  assert.ok(includesBytes(customerBytes, [0x1b, 0x45, 1]), 'customer output uses bold text');
  const expectedTotalBytes = Buffer.from(
    width === '58mm' ? 'TOTAL\nRs. 120,044.88\n' : 'TOTAL Rs. 120,044.88\n',
    'ascii',
  );
  assert.ok(includesBytes(customerBytes, expectedTotalBytes), `${width} preserves the whole total amount`);
  for (const [ticket, bytes] of [['customer', customerBytes], ['kitchen', kitchenBytes]]) {
    assert.ok(!includesBytes(bytes, [0x1b, 0x64]), `${ticket} stream has no redundant full-line feed`);
    assert.equal(
      Array.from(bytes).filter((byte, index, all) =>
        byte === 0x1d && all[index + 1] === 0x56,
      ).length,
      1,
      `${ticket} stream has exactly one terminal cut`,
    );
  }
  assert.ok(kitchenBytes.length < customerBytes.length, `${width} kitchen byte stream is shorter`);
}

// Check the actual authored receipt CSS for compact, non-clipping 58/80mm rules.
const receiptCss = fs.readFileSync(path.join(root, 'src/components/receipt/Receipt.module.css'), 'utf8');
const receiptRule = (selector) => {
  const start = receiptCss.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `receipt stylesheet contains ${selector}`);
  const open = receiptCss.indexOf('{', start);
  const close = receiptCss.indexOf('}', open);
  assert.ok(close > open, `receipt stylesheet closes ${selector}`);
  return receiptCss.slice(open + 1, close);
};
assert.match(receiptRule('.w80'), /font-size:\s*15px/);
assert.match(receiptRule('.w58'), /font-size:\s*13px/);
assert.match(receiptRule('.kitchenSheet'), /font-size:\s*14px/);
assert.match(receiptRule('.w58.kitchenSheet'), /font-size:\s*12px/);
assert.match(receiptRule('.logo'), /max-width:\s*54mm[\s\S]*max-height:\s*24mm/);
assert.match(receiptRule('.w58 .logo'), /max-width:\s*42mm[\s\S]*max-height:\s*20mm/);
assert.match(receiptRule('.colQty'), /font-weight:\s*700[\s\S]*overflow-wrap:\s*anywhere/);
assert.match(receiptRule('.totalRow dd'), /overflow-wrap:\s*anywhere/);
assert.doesNotMatch(receiptRule('.sheet'), /(?:^|\n)\s*height\s*:/);

// Long receipts grow with content rather than inheriting a viewport height.
const shortHeight = printService.measureHeightMm({
  scrollHeight: 100,
  getBoundingClientRect: () => ({ height: 99 }),
});
const longHeight = printService.measureHeightMm({
  scrollHeight: 820,
  getBoundingClientRect: () => ({ height: 819 }),
});
assert.ok(shortHeight > 0 && shortHeight < longHeight);
assert.ok(longHeight - shortHeight > 150);

// The print document explicitly requests both physical dimensions and no page margins.
for (const width of ['58mm', '80mm']) {
  let applied = null;
  const mockDocument = {
    getElementById: () => null,
    createElement: (tag) => ({ tagName: tag, id: '', media: '', textContent: '' }),
    head: { appendChild: (style) => { applied = style; } },
  };
  printService.applyPageSize(width, width === '58mm' ? 47.2 : 72.6, mockDocument);
  assert.equal(applied.media, 'print');
  assert.match(applied.textContent, new RegExp(`@page \\{ size: ${width} `));
  assert.match(applied.textContent, /47\.2mm|72\.6mm/);
  assert.match(applied.textContent, /margin: 0/);
}

// Verify the actual logo command uses an aspect-preserving, bounded native-canvas raster.
const originalDocument = global.document;
const originalImage = global.Image;
let canvasDimensions = null;
let drawDimensions = null;
global.Image = class TestImage {
  naturalWidth = 1000;
  naturalHeight = 500;
  width = 1000;
  height = 500;
  async decode() {}
};
global.document = {
  createElement: (tag) => {
    assert.equal(tag, 'canvas');
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: '#fff',
        fillRect() {},
        drawImage(_image, _x, _y, width, height) {
          drawDimensions = [width, height];
        },
        getImageData(_x, _y, width, height) {
          canvasDimensions = [width, height];
          const data = new Uint8ClampedArray(width * height * 4);
          for (let i = 0; i < data.length; i += 4) {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255;
          }
          return { data };
        },
      }),
    };
    return canvas;
  },
};

try {
  const withLogo = {
    ...model,
    header: {
      ...model.header,
      logo: {
        dataUrl: 'data:image/png;base64,AA==',
        type: 'image/png',
        width: 1000,
        height: 500,
        bytes: 1,
        fileName: 'logo.png',
      },
    },
  };

  const bytes80 = await escpos.encodeReceiptWithLogo(withLogo, '80mm');
  const expectedWidth80 = Math.floor((24 * 203) / 25.4) * 2;
  const expectedHeight80 = Math.floor((24 * 203) / 25.4);
  assert.deepEqual(drawDimensions, [expectedWidth80, expectedHeight80]);
  assert.deepEqual(canvasDimensions, [expectedWidth80, expectedHeight80]);
  const logoCommand = [0x1d, 0x76, 0x30, 0x00];
  const logoOffset = Array.from(bytes80).findIndex((_, index, all) =>
    logoCommand.every((byte, position) => all[index + position] === byte),
  );
  assert.ok(logoOffset >= 0, 'saved logo appears as a GS v 0 raster command');
  assert.equal(bytes80[logoOffset + 4] + (bytes80[logoOffset + 5] << 8), Math.ceil(expectedWidth80 / 8));
  assert.equal(bytes80[logoOffset + 6] + (bytes80[logoOffset + 7] << 8), expectedHeight80);

  const bytes58 = await escpos.encodeReceiptWithLogo(withLogo, '58mm');
  const expectedWidth58 = Math.floor((20 * 203) / 25.4) * 2;
  const expectedHeight58 = Math.floor((20 * 203) / 25.4);
  assert.deepEqual(drawDimensions, [expectedWidth58, expectedHeight58]);
  assert.deepEqual(canvasDimensions, [expectedWidth58, expectedHeight58]);
  const logoOffset58 = Array.from(bytes58).findIndex((_, index, all) =>
    logoCommand.every((byte, position) => all[index + position] === byte),
  );
  assert.ok(logoOffset58 >= 0, '58mm output includes the saved logo');
  assert.equal(bytes58[logoOffset58 + 4] + (bytes58[logoOffset58 + 5] << 8), Math.ceil(expectedWidth58 / 8));
  assert.equal(bytes58[logoOffset58 + 6] + (bytes58[logoOffset58 + 7] << 8), expectedHeight58);
} finally {
  if (originalDocument === undefined) delete global.document;
  else global.document = originalDocument;
  if (originalImage === undefined) delete global.Image;
  else global.Image = originalImage;
}

console.log(
  'Receipt checks passed: 58/80mm text-column wrapping, long names/values, price and total presence, compact customer/kitchen ESC/POS streams, one-dot cut command, content-height measurement, explicit zero-margin page sizes, and proportional bounded logo raster dimensions.',
);
