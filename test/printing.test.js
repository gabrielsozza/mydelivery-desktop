const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { receiptDocument } = require('../receipt-document');
const { createPrintingService, selectPrinter } = require('../driver-print');

const sample = Buffer.from('\x1b@\x1bt\x03\x1ba\x01\x1b!\x30PEDIDO 123\n\x1b!\0\x1ba\0\x1bE\x012x Pizza\x1bE\0\nTOTAL: R$ 80,00\n\x1dV\x01', 'ascii');
function setup(t, behavior) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-print-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const jobs = [], raw = [], windows = [];
  let printers = [{ name: 'OneNote (Desktop)', isDefault: true }, { name: 'EPSON TM-T20', isDefault: false }];
  class Window {
    constructor(options) {
      this.options = options; this.destroyed = false; windows.push(this);
      this.webContents = { print: (options, callback) => { jobs.push(options); if (behavior) behavior(callback); else callback(true); } };
    }
    async loadURL(url) { this.html = decodeURIComponent(url.split(',').slice(1).join(',')); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const options = { app: { getPath: () => dir }, BrowserWindow: Window, rawPrint: async (...args) => raw.push(args), getContents: () => ({ getPrintersAsync: async () => printers }) };
  return { service: createPrintingService(options), options, jobs, raw, windows, setPrinters: value => { printers = value; } };
}

test('receipt preserves amounts and formatting and escapes HTML', () => {
  const html = receiptDocument(Buffer.concat([sample, Buffer.from('<script>alert(1)</script>\n')]));
  assert.match(html, /TOTAL: R\$ 80,00/);
  assert.match(html, /font-size:22px/); assert.match(html, /font-weight:700/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});
test('fiscal raster QR preserves pixels and validates truncated payloads', () => {
  const qr = Buffer.from([29,118,48,0,1,0,2,0,128,1]);
  const html = receiptDocument(Buffer.concat([sample,qr]));
  assert.match(html, /viewBox="0 0 8 2"/); assert.match(html, /M0 0h1v1h-1zM7 1h1v1h-1z/);
  assert.throws(() => receiptDocument(qr.subarray(0,9)), /incompleto/);
  assert.throws(() => receiptDocument(Buffer.from([29,118,48,0,255,255,255,255])), /inválida/);
});
test('OneNote always uses the installed driver, even with legacy raw preference', async t => {
  const f = setup(t);
  f.setPrinters([{name:'OneNote (Desktop)',isDefault:true}]);
  const result = await f.service.print(sample);
  assert.equal(result.ok, true); assert.equal(result.via, 'driver');
  assert.equal(f.jobs[0].deviceName, 'OneNote (Desktop)'); assert.equal(f.jobs[0].silent, true);
  assert.equal(f.raw.length, 0); assert.equal(f.windows[0].destroyed, true);
  assert.equal(f.windows[0].options.webPreferences.javascript, false);
});
test('selection persists across restart; removed printer does not silently reroute', async t => {
  const f = setup(t);
  await f.service.save({ printerName: 'EPSON TM-T20', width: 58, mode: 'driver' });
  const restarted = createPrintingService(f.options);
  await restarted.print(sample);
  assert.equal(f.jobs[0].deviceName, 'EPSON TM-T20'); assert.match(f.windows[0].html, /width:58mm/);
  f.setPrinters([{ name:'OneNote (Desktop)', isDefault:true }]);
  await assert.rejects(restarted.print(sample), /não está instalada/);
  assert.equal(f.jobs.length,1);
});
test('raw remains available for compatible physical printers only', async t => {
  const f = setup(t);
  await assert.rejects(f.service.save({ printerName:'OneNote (Desktop)', width:80, mode:'raw' }), /driver/);
  await f.service.save({ printerName:'EPSON TM-T20', width:80, mode:'raw' });
  await f.service.print(sample);
  assert.equal(f.raw.length,1); assert.equal(f.raw[0][1],'EPSON TM-T20'); assert.equal(f.jobs.length,0);
});
test('driver failure closes the window without sending a second raw copy', async t => {
  const f = setup(t, callback => callback(false, 'Print job failed'));
  await assert.rejects(f.service.print(sample, 'OneNote (Desktop)'), /Abra o OneNote/);
  assert.equal(f.jobs.length,1); assert.equal(f.raw.length,0); assert.equal(f.windows[0].destroyed,true);
});
test('concurrent receipts wait for each driver callback', async t => {
  const callbacks = [], f = setup(t, callback => callbacks.push(callback));
  await f.service.save({printerName:'EPSON TM-T20',width:80,mode:'driver'});
  const a = f.service.print(sample), b = f.service.print(sample);
  await new Promise(setImmediate); assert.equal(f.jobs.length,1);
  callbacks[0](true); await a; await new Promise(setImmediate); assert.equal(f.jobs.length,2);
  callbacks[1](true); await b; assert.ok(f.windows.every(w=>w.destroyed));
});
test('without a default, never picks an arbitrary virtual printer', () => {
  assert.throws(()=>selectPrinter([{name:'Microsoft Print to PDF'}]), /Escolha uma impressora/);
  assert.equal(selectPrinter([{name:'OneNote'}, {name:'Thermal'}]).name,'Thermal');
  assert.equal(selectPrinter([{name:'OneNote',isDefault:true}, {name:'EPSON TM-T20'}]).name,'EPSON TM-T20');
  assert.equal(selectPrinter([{name:'OneNote',isDefault:true}, {name:'EPSON TM-T20'}], 'OneNote').name,'OneNote');
});
test('receipt emitted by the live web builder retains items, total and fiscal QR', () => {
  const html = receiptDocument(require('./fixtures/receipt.json'));
  for (const text of ['Pizza Calabresa', 'Sem cebola', 'Borda de catupiry', '88,00', 'PIX', 'DANFE NFC-e', 'HOMOLOGACAO']) assert.ok(html.includes(text), text);
  assert.match(html, /aria-label="QR Code da nota fiscal"/);
});

test('cashier and kitchen each receive one copy with independent paper settings', async t => {
  const f = setup(t);
  await f.service.save({printerName:'EPSON TM-T20',width:80,mode:'driver',kitchen:{printerName:'OneNote (Desktop)',width:58,mode:'driver'}});
  const restarted = createPrintingService(f.options);
  const result = await restarted.print(sample);
  assert.equal(result.ok,true);
  assert.deepEqual(f.jobs.map(j=>j.deviceName),['EPSON TM-T20','OneNote (Desktop)']);
  assert.match(f.windows[0].html,/width:80mm/); assert.match(f.windows[1].html,/width:58mm/);
});
test('same printer in cashier and kitchen receives only one copy', async t => {
  const f = setup(t);
  await f.service.save({printerName:'EPSON TM-T20',width:80,mode:'driver',kitchen:{printerName:'EPSON TM-T20',width:58,mode:'driver'}});
  await f.service.print(sample);
  assert.equal(f.jobs.length,1);
});
test('partial retry after app restart sends only the missing copy, despite updated timestamp', async t => {
  let attempt = 0;
  const f = setup(t, cb => cb(++attempt !== 2, 'Offline'));
  await f.service.save({printerName:'EPSON TM-T20',width:80,mode:'driver',kitchen:{printerName:'OneNote (Desktop)',width:80,mode:'driver'}});
  const first = Buffer.concat([sample,Buffer.from('14/10/2026, 14:00:00\n')]);
  const retry = Buffer.concat([sample,Buffer.from('14/10/2026, 14:02:00\n')]);
  await assert.rejects(f.service.print(first),/Cozinha.*Offline/);
  await createPrintingService(f.options).print(retry);
  assert.deepEqual(f.jobs.map(j=>j.deviceName),['EPSON TM-T20','OneNote (Desktop)','OneNote (Desktop)']);
  // Once complete, a deliberate reprint can print both copies again.
  await f.service.print(retry);
  assert.equal(f.jobs.length,5);
});
test('cashier failure does not prevent kitchen copy; retry skips accepted kitchen', async t => {
  let attempt = 0;
  const f = setup(t, cb => cb(++attempt !== 1, 'Offline'));
  await f.service.save({printerName:'EPSON TM-T20',width:80,mode:'driver',kitchen:{printerName:'OneNote (Desktop)',width:80,mode:'driver'}});
  await assert.rejects(f.service.print(sample),/Caixa.*Offline/);
  await f.service.print(sample);
  assert.deepEqual(f.jobs.map(j=>j.deviceName),['EPSON TM-T20','OneNote (Desktop)','EPSON TM-T20']);
});
test('disabled kitchen restores single-printer behavior; missing destination never reroutes', async t => {
  const f = setup(t);
  const config = {printerName:'EPSON TM-T20',width:80,mode:'driver',kitchen:{printerName:'OneNote (Desktop)',width:80,mode:'driver'}};
  await f.service.save(config);
  f.setPrinters([{name:'EPSON TM-T20',isDefault:true}]);
  await assert.rejects(f.service.print(sample), /não está instalada/);
  assert.equal(f.jobs.length,0);
  await f.service.save({...config,kitchen:null});
  await f.service.print(sample); assert.equal(f.jobs.length,1);
});
