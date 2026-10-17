const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { receiptDocument, thermalReceipt, layoutReceipt } = require('../receipt-document');
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
  assert.match(html, /font-size:20px/); assert.match(html, /font-size:14px/);
  assert.match(html, /font-weight:700/); assert.match(html, /font-weight:900/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});
test('fiscal raster QR preserves pixels and validates truncated payloads', () => {
  const qr = Buffer.from([29,118,48,0,1,0,2,0,128,1]);
  const html = receiptDocument(Buffer.concat([sample,qr]));
  assert.match(html, /viewBox="0 0 8 2"/); assert.match(html, /M0 0h1v1h-1zM7 1h1v1h-1z/);
  assert.throws(() => receiptDocument(qr.subarray(0,9)), /incomplet[oa]/);
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
test('unconfigured thermal printer keeps direct transport after an app update', async t => {
  const f = setup(t);
  f.setPrinters([{name:'MTP-II Bluetooth',isDefault:true}]);
  const result = await f.service.print(sample);
  assert.equal(f.service.settings().mode,'auto');
  assert.equal(result.via,'raw'); assert.equal(f.raw.length,1); assert.equal(f.jobs.length,0);
});
test('automatic mode persists and preserves each physical/virtual destination', async t => {
  const f = setup(t);
  await f.service.save({printerName:'EPSON TM-T20',width:58,mode:'auto',kitchen:{printerName:'OneNote (Desktop)',width:80,mode:'auto'}});
  await createPrintingService(f.options).print(sample);
  assert.equal(f.raw.length,1); assert.equal(f.raw[0][1],'EPSON TM-T20');
  assert.equal(f.jobs.length,1); assert.equal(f.jobs[0].deviceName,'OneNote (Desktop)');
});
test('strong thermal text preserves complete fiscal image data and does not double character width', () => {
  const raster=Buffer.from([29,118,48,0,1,0,6,0,27,69,0,27,33,0]);
  const result=thermalReceipt(Buffer.concat([sample,raster]));
  assert.notEqual(result.indexOf(raster),-1);
  assert.notEqual(result.indexOf(Buffer.from([27,69,1,27,71,1])), -1);
  assert.notEqual(result.indexOf(Buffer.from([27,33,8])), -1);
  assert.throws(()=>thermalReceipt(raster.subarray(0,10)),/incompleta/);
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

const manaReceipt = Buffer.from('\x1b@\x1ba\0\x1bE\x01(1) Pizza Tradicional Pequena\x1bE\0\n\x1ba\0\x1bE\x01                       R$ 30,00\x1bE\0\n\x1ba\0  + Frango com Catupiry (R$ 30,00)\n\x1ba\0\x1bE\x01(1) Refrigerante 1 L     R$ 10,00\x1bE\0\n\x1ba\0  + Coca-Cola Original\n','ascii');
function visibleRows(bytes) {
  return bytes.toString('ascii').replace(/\x1b@|\x1b[!aEtG][\s\S]/g,'').split('\n').filter(Boolean);
}
test('Mana photo: quantity, full pizza name and amount share one line on 58 and 80 mm', () => {
  for (const width of [58,80]) {
    const result = layoutReceipt(manaReceipt,width), rows = visibleRows(result);
    assert.equal(rows.length,4);
    assert.match(rows[0],/^\(1\) Pizza Tradicional Pequena\s+R\$ 30,00$/);
    assert.equal(rows[1],'  + Frango com Catupiry (R$ 30,00)');
    assert.match(rows[2],/^\(1\) Refrigerante 1 L\s+R\$ 10,00$/);
    assert.ok(rows.every(r=>r.length <= (width === 58 ? 42 : 48)));
    assert.equal(result.includes(Buffer.from([27,33,1])),width === 58);
    assert.deepEqual(layoutReceipt(result,width), result, 'layout is stable when printed again');
  }
});
test('layout never interprets line breaks or fake item text inside raster pixels', () => {
  const pixels=Buffer.from('\n(1) Pizza\n R$ 20,00\n','ascii');
  const raster=Buffer.concat([Buffer.from([29,118,48,0,1,0,pixels.length,0]),pixels]);
  assert.deepEqual(layoutReceipt(raster,58),raster);
});
test('cashier 80 mm and kitchen 58 mm format independently without losing amounts', async t => {
  const f=setup(t); f.setPrinters([{name:'Caixa'},{name:'Cozinha'}]);
  await f.service.save({printerName:'Caixa',width:80,mode:'raw',kitchen:{printerName:'Cozinha',width:58,mode:'raw'}});
  await f.service.print(manaReceipt);
  assert.equal(f.raw.length,2);
  for(const [bytes] of f.raw) assert.match(visibleRows(bytes)[0],/Pizza Tradicional Pequena\s+R\$ 30,00/);
  assert.equal(visibleRows(f.raw[0][0])[0].length,48);
  assert.equal(visibleRows(f.raw[1][0])[0].length,42);
});

test('addresses use legible 80 mm and compact 58 mm sizes without enlarging pickup labels', () => {
  const text = 'Entrega: Avenida Governador Carlos Lindenberg, 1234, Bloco B, Parque Vitoria, Sao Luis - MA, CEP 65000-000';
  const bytes = Buffer.from('\x1b@' + text + '\nTotal: R$ 50,00\n');
  const wide = receiptDocument(bytes,80), narrow = receiptDocument(bytes,58);
  assert.match(wide, /class="line address"/);
  assert.match(wide, /font-size:14px[^>]*>Entrega:/);
  assert.ok(wide.includes(text));
  assert.match(narrow, /font-size:12.5px[^>]*>Entrega:/);
  assert.doesNotMatch(receiptDocument(Buffer.from('Entrega: Retirada no local\n'),80), /class="line address"/);
  for (const width of [58,80]) {
    const raw = thermalReceipt(bytes,width);
    assert.ok(!raw.includes(Buffer.from([29,118,48])), 'address must never become a clipped raster');
    const rows = visibleRows(raw);
    assert.equal(rows.slice(0,-1).join(' '),text);
    assert.ok(rows.slice(0,-1).every(row=>row.length <= (width === 58 ? 32 : 48)));
    assert.equal(rows.at(-1),'Total: R$ 50,00');
    assert.ok(raw.includes(Buffer.from([27,33,8])), 'normal size, bold body font');
    assert.ok(!raw.includes(Buffer.from([27,33,24])), 'no enlarged address');
  }
});

test('80 mm headings grow vertically and reset before body text; 58 mm retains native height', () => {
  const bytes = Buffer.from('\x1b@\x1ba\0\x1bE\x01Cliente\x1bE\0\nNome: Cliente Teste\nItens\nPagamento\n');
  const wide = thermalReceipt(bytes,80), narrow = thermalReceipt(bytes,58);
  assert.equal(wide.toString('ascii').split('\x1b!\x18').length - 1,3);
  assert.ok(wide.includes(Buffer.from('\x1b!\x08\nNome: Cliente Teste')));
  assert.ok(!narrow.includes(Buffer.from([27,33,24])));
  assert.match(receiptDocument(bytes,80), /class="line heading"[^>]*><span style="font-weight:900;font-size:20px/);
  assert.doesNotMatch(receiptDocument(bytes,58), /class="line heading"/);
});
