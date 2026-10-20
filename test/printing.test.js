const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { receiptDocument, thermalReceipt, layoutReceipt, kitchenReceipt } = require('../receipt-document');
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
  assert.match(html.replace(/<[^>]*>/g,''), /TOTAL: R\$ 80,00/);
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
  assert.equal(f.jobs[0].deviceName, 'EPSON TM-T20'); assert.match(f.windows[0].html, /data-paper-width="58"/);
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

test('kitchen removes customer and payment sections from the live receipt, preserving items and fiscal raster', () => {
  const original = Buffer.from(require('./fixtures/receipt.json'));
  const kitchen = kitchenReceipt(original);
  for (const width of [58,80]) {
    for (const rendered of [receiptDocument(kitchen,width),thermalReceipt(kitchen,width).toString('ascii')]) {
      for (const value of ['DELIVERY','Pedido 123','Pizza Calabresa','Sem cebola','Borda de catupiry','DANFE NFC-e']) assert.ok(rendered.includes(value),value);
      for (const value of ['Cliente de teste','(00) 00000-0000','Rua de teste','Pagamento','PIX','R$','Subtotal:','Taxa de entrega:','Total:']) assert.ok(!rendered.includes(value),value);
    }
  }
  assert.deepEqual(kitchenReceipt(kitchen),kitchen);
  assert.ok(original.includes(Buffer.from('Cliente de teste')), 'original cashier bytes remain unchanged');
  assert.match(receiptDocument(kitchen),/aria-label="QR Code da nota fiscal"/);
});

function kitchenOrder({type='DELIVERY',opa=false}={}) {
  const sep='--------------------------------\n';
  const items='Itens\n(2) X Burger R$ 40,00\n  + Queijo (R$ 2,00)\n  + Sem cebola\n'+sep;
  const customer='Cliente\nNome: Nome privado\nSobrenome privado\nTelefone: 11999999999\nEntrega: Rua privada\nComplemento privado\n'+(type==='MESA'?'Mesa: 12\n':type==='RETIRADA'?'Entrega: Retirada no local\n':type==='BALCAO'?'Tipo: Pedido balcao\n':'')+sep;
  return Buffer.from('\x1b@*** ADICIONAL ***\n'+type+'\nLoja\nPedido 123\nEntrega prevista: 18:00 - 18:30\n'+sep+(opa?items+customer:customer+items)+
    'Pagamento\nDividida entre 2 pessoas\nPessoa 1 - PIX R$ 20,00\nPessoa 2 - DINHEIRO R$ 20,00\n* PAGO ONLINE *\n'+sep+
    'Subtotal: R$ 40,00\nTaxa de entrega: Gratis\nDesconto: - R$ 1,00\nServico (10%): R$ 4,00\nTotal: R$ 43,00\nTroco para: R$ 50,00\nTroco: R$ 7,00\n'+sep+
    '* Separar molhos\nCuidado com alergia *\n'+sep+'Powered By: MyDelivery\n\n\x1dV\x01','ascii');
}
test('all service modes and both section orders retain preparation notes, ETA, table and paper cut', () => {
  for (const type of ['DELIVERY','RETIRADA','BALCAO','MESA']) for (const opa of [false,true]) {
    const original=kitchenOrder({type,opa}), result=kitchenReceipt(original).toString('ascii');
    for (const value of [type,'*** ADICIONAL ***','Pedido 123','Entrega prevista: 18:00 - 18:30','(2) X Burger','Queijo','Sem cebola','Separar molhos','Cuidado com alergia','\x1dV\x01']) assert.ok(result.includes(value),value);
    for (const value of ['privado','privada','11999999999','Pagamento','Pessoa 1','Pessoa 2','PAGO ONLINE','R$','Total:','Subtotal:','Taxa de entrega:','Servico (10%):','Troco','Desconto:']) assert.ok(!result.includes(value),value);
    if(type==='MESA') assert.ok(result.includes('Mesa: 12'));
    if(type==='RETIRADA') assert.ok(result.includes('Retirada no local'));
  }
});
test('kitchen never interprets raster bytes as customer or payment section headings', () => {
  const pixels=Buffer.from('\nCliente\nPagamento\n');
  const raster=Buffer.concat([Buffer.from([29,118,48,0,1,0,pixels.length,0]),pixels]);
  assert.deepEqual(kitchenReceipt(raster),raster);
});
for(const mode of ['driver','raw']) test('only the kitchen copy is filtered with '+mode, async t => {
  const f=setup(t); f.setPrinters([{name:'Caixa'},{name:'Cozinha 2'}]);
  await f.service.save({printerName:'Caixa',width:80,mode,kitchen:{printerName:'Cozinha 2',width:58,mode}});
  const original=kitchenOrder();
  await f.service.print(original);
  const content=mode==='raw'?f.raw.map(job=>job[0].toString('ascii')):f.windows.map(w=>w.html);
  assert.equal(content.length,2);
  assert.ok(content[0].includes('Nome privado')); assert.ok(content[0].includes('PIX'));
  assert.ok(!content[1].includes('Nome privado')); assert.ok(!content[1].includes('PIX'));
  assert.ok(content.every(text=>text.includes('X Burger') && text.includes('Cuidado com alergia')));
  await f.service.print(original,'Cozinha 2');
  const direct=mode==='raw'?f.raw.at(-1)[0].toString('ascii'):f.windows.at(-1).html;
  assert.ok(!direct.includes('Nome privado')); assert.ok(direct.includes('X Burger'));
});
test('a shared cashier/kitchen printer retains its single complete cashier copy', async t => {
  const f=setup(t); f.setPrinters([{name:'Caixa'}]);
  await f.service.save({printerName:'Caixa',width:80,mode:'raw',kitchen:{printerName:'Caixa',width:58,mode:'raw'}});
  await f.service.print(kitchenOrder());
  assert.equal(f.raw.length,1); assert.ok(f.raw[0][0].includes(Buffer.from('Nome privado')));
});

test('cashier and kitchen each receive one copy with independent paper settings', async t => {
  const f = setup(t);
  await f.service.save({printerName:'EPSON TM-T20',width:80,mode:'driver',kitchen:{printerName:'OneNote (Desktop)',width:58,mode:'driver'}});
  const restarted = createPrintingService(f.options);
  const result = await restarted.print(sample);
  assert.equal(result.ok,true);
  assert.deepEqual(f.jobs.map(j=>j.deviceName),['EPSON TM-T20','OneNote (Desktop)']);
  assert.match(f.windows[0].html,/data-paper-width="80"/); assert.match(f.windows[1].html,/data-paper-width="58"/);
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
    assert.match(rows[1],/^  \+ Frango com Catupiry\s+\(R\$ 30,00\)$/);
    assert.match(rows[2],/^\(1\) Refrigerante 1 L\s+R\$ 10,00$/);
    assert.ok(rows.every(r=>r.length <= (width === 58 ? 40 : 44)));
    assert.equal(result.includes(Buffer.from([27,33,1])),width === 58);
    assert.deepEqual(layoutReceipt(result,width), result, 'layout is stable when printed again');
  }
});
test('layout never interprets line breaks or fake item text inside raster pixels', () => {
  const pixels=Buffer.from('\n(1) Pizza\n R$ 20,00\n','ascii');
  const raster=Buffer.concat([Buffer.from([29,118,48,0,1,0,pixels.length,0]),pixels]);
  assert.deepEqual(layoutReceipt(raster,58),raster);
});
test('cashier 80 mm retains amounts and kitchen 58 mm retains only preparation items', async t => {
  const f=setup(t); f.setPrinters([{name:'Caixa'},{name:'Cozinha'}]);
  await f.service.save({printerName:'Caixa',width:80,mode:'raw',kitchen:{printerName:'Cozinha',width:58,mode:'raw'}});
  await f.service.print(manaReceipt);
  assert.equal(f.raw.length,2);
  assert.match(visibleRows(f.raw[0][0])[0],/Pizza Tradicional Pequena\s+R\$ 30,00/);
  assert.equal(visibleRows(f.raw[1][0])[0],'(1) Pizza Tradicional Pequena');
  assert.doesNotMatch(f.raw[1][0].toString('ascii'),/R\$/);
  assert.equal(visibleRows(f.raw[0][0])[0].length,38);
  assert.ok(visibleRows(f.raw[1][0]).every(row=>row.length<=40));
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
    assert.ok(rows.slice(0,-1).every(row=>row.length <= (width === 58 ? 30 : 44)));
    assert.match(rows.at(-1),/^Total:\s+R\$ 50,00$/);
    assert.ok(raw.includes(Buffer.from([27,33,8])), 'normal size, bold body font');
    assert.ok(!raw.includes(Buffer.from([27,33,24])), 'no enlarged address');
  }
});

test('80 mm headings grow vertically and reset before body text; 58 mm retains native height', () => {
  const bytes = Buffer.from('\x1b@\x1ba\0\x1bE\x01Cliente\x1bE\0\nNome: Cliente Teste\nItens\nPagamento\n');
  const wide = thermalReceipt(bytes,80), narrow = thermalReceipt(bytes,58);
  assert.equal(wide.toString('ascii').split('\x1b!\x18').length - 1,3);
  assert.match(wide.toString('ascii'), /\x1b!\x08(?:\x1b[EG][\s\S])*Nome: Cliente Teste/);
  assert.ok(!narrow.includes(Buffer.from([27,33,24])));
  assert.match(receiptDocument(bytes,80), /class="line heading"[^>]*><span style="font-weight:900;font-size:20px/);
  assert.doesNotMatch(receiptDocument(bytes,58), /class="line heading"/);
});

 test('long customer names and right-aligned amounts stay inside safe native columns', () => {
  const name = 'Nome: Cliente Teste Com Sobrenome Muito Longo Para Conferencia';
  const bytes = Buffer.from('\x1b@' + name + '\n(1) Media                   R$ 37,00\nSubtotal: R$ 37,00\nTaxa de entrega: R$ 5,00\nTotal: R$ 42,00\n');
  for (const width of [58,80]) {
    const rows = visibleRows(thermalReceipt(bytes,width));
    assert.ok(rows.every(row=>row.length <= (width === 58 ? 30 : 44)));
    const firstItem = rows.findIndex(row=>row.startsWith('(1)'));
    assert.equal(rows.slice(0,firstItem).join(' '),name);
    assert.match(rows.at(-1),/Total:\s+R\$ 42,00$/);
    assert.equal(rows.filter(row=>/R\$/.test(row)).length,4);
  }
});

test('Talentos: item, flavor and total cents retain a dedicated right gutter', () => {
  const receipt = Buffer.from('(1) Media                   R$ 37,00\n  + Frango Com Catupiry (R$ 18,50)\n  + Calabresa (R$ 18,50)\nSubtotal: R$ 37,00\nTaxa de entrega: R$ 10,00\nTotal: R$ 47,00\n');
  for (const width of [58,80]) {
    const rows = visibleRows(thermalReceipt(receipt,width));
    assert.equal(rows.length,6);
    assert.deepEqual(rows.map(r=>r.match(/R\$ [\d.,]+/)[0]), ['R$ 37,00','R$ 18,50','R$ 18,50','R$ 37,00','R$ 10,00','R$ 47,00']);
    for (const r of rows) assert.ok(r.length <= (width === 58 && r.includes('Frango') ? 38 : width === 58 ? 28 : 38), r);
  }
});
