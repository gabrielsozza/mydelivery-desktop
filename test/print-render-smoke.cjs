// Exercises the actual Chromium renderer and preload without printing paper,
// connecting to a restaurant or changing the user's printer preferences.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { receiptDocument, kitchenReceipt } = require('../receipt-document');
const output = process.env.MD_PRINT_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'md-print-render-'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'md-print-profile-')));
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => app.exit(1), 30000);
let settings = { printerName: 'OneNote (Desktop)', width: 80, mode: 'driver' };
ipcMain.handle('md:config-impressora', (_event, action, value) => {
  if (action === 'save') settings = value;
  return { ok:true, settings, automaticPrinter:'EPSON TM-T20', printers:[{name:'OneNote (Desktop)',isDefault:true},{name:'EPSON TM-T20'}] };
});
app.whenReady().then(async () => {
  const ui = new BrowserWindow({show:false,width:660,height:820,webPreferences:{preload:path.join(__dirname,'../preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await ui.loadFile(path.join(__dirname,'../print-settings.html'));
  const deadline = Date.now() + 5000;
  while (await ui.webContents.executeJavaScript('document.querySelector("#printer").disabled')) {
    if (Date.now() > deadline) throw Error('Printer settings failed to load');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(await ui.webContents.executeJavaScript('document.querySelector("#virtual-note").hidden'), false);
  fs.writeFileSync(path.join(output,'onenote-settings.png'), (await ui.webContents.capturePage()).toPNG());
  await ui.webContents.executeJavaScript('document.querySelector("#printer").value="EPSON TM-T20"; document.querySelector("#printer").dispatchEvent(new Event("change")); document.querySelector("#kitchen").value="OneNote (Desktop)"; document.querySelector("#kitchen").dispatchEvent(new Event("change")); document.querySelector("#kitchen-width").value="58"; document.querySelector("#save").click()');
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(settings.printerName,'EPSON TM-T20');
  assert.equal(settings.kitchen.printerName,'OneNote (Desktop)');
  assert.equal(settings.kitchen.width,58);
  assert.match(await ui.webContents.executeJavaScript('document.querySelector("#status").textContent'), /salva/);
  fs.writeFileSync(path.join(output,'printer-settings.png'), (await ui.webContents.capturePage()).toPNG());
  ui.destroy();
  const receipt = new BrowserWindow({show:false,width:420,height:1200,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:true}});
  await receipt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptDocument(require('./fixtures/receipt.json'))));
  const pdf = await receipt.webContents.printToPDF({printBackground:true,pageSize:'A4'});
  assert.ok(pdf.length > 5000);
  fs.writeFileSync(path.join(output,'receipt.pdf'),pdf);
  fs.writeFileSync(path.join(output,'receipt.png'),(await receipt.webContents.capturePage()).toPNG());
  await receipt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptDocument(require('./fixtures/receipt.json'),58)));
  const narrow = await receipt.webContents.executeJavaScript('({width:document.body.clientWidth,scroll:document.body.scrollWidth})');
  assert.ok(narrow.scroll <= narrow.width + 1, '58 mm receipt must not crop horizontally');
  fs.writeFileSync(path.join(output,'receipt-58mm.png'),(await receipt.webContents.capturePage()).toPNG());

  const mana = Buffer.from('\x1b@\x1ba\0\x1bE\x01(1) Pizza Tradicional Pequena\x1bE\0\n\x1ba\0\x1bE\x01                       R$ 30,00\x1bE\0\n\x1ba\0  + Frango com Catupiry (R$ 30,00)\n\x1ba\0\x1bE\x01(1) Refrigerante 1 L     R$ 10,00\x1bE\0\n\x1ba\0  + Coca-Cola Original\n','ascii');
  for (const width of [58,80]) {
    await receipt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptDocument(mana,width)));
    const rows = await receipt.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.line')).map(el=>({text:el.textContent,width:el.clientWidth,scroll:el.scrollWidth,whiteSpace:getComputedStyle(el).whiteSpace}))`);
    assert.equal(rows.length,4);
    assert.match(rows[0].text,/Pizza Tradicional Pequena\s+R\$ 30,00/);
    assert.ok(rows.every(r=>r.scroll<=r.width+1), 'Names and amounts fit on the same line without clipping: ' + JSON.stringify({width,rows}));
    fs.writeFileSync(path.join(output,`mana-${width}mm.png`),(await receipt.webContents.capturePage()).toPNG());
  }
  const addressText = 'Entrega: Avenida Governador Carlos Lindenberg, 1234, Bloco B, Parque Vitoria, Sao Luis - MA, CEP 65000-000';
  const addressBytes = Buffer.from('\x1b@' + addressText + '\nTotal: R$ 50,00\n');
  for (const width of [58,80]) {
    await receipt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptDocument(addressBytes,width)));
    const bounds = await receipt.webContents.executeJavaScript(`({body:document.body.clientWidth,scroll:document.body.scrollWidth,size:getComputedStyle(document.querySelector('.line span')).fontSize,height:document.querySelector('.line').clientHeight})`);
    assert.ok(bounds.scroll <= bounds.body + 1);
    assert.equal(bounds.size,width === 80 ? '14px' : '12.5px'); assert.ok(bounds.height > 30);
    fs.writeFileSync(path.join(output,`address-${width}mm.png`),(await receipt.webContents.capturePage()).toPNG());
  }
  const complete = Buffer.from('\x1b@\x1ba\x01PARA ENTREGA\n17/10/2026, 15:00:00\nLoja de Teste\n================================\nPedido 12345\n--------------------------------\n\x1ba\0Cliente\nNome: Cliente Teste\nTelefone: (11) 90000-0000\n' + addressText + '\n--------------------------------\nItens\n(1) Pizza Tradicional Pequena\n                       R$ 30,00\n  + Frango com Catupiry\n(1) Refrigerante 1 L     R$ 10,00\n  + Coca-Cola Original\n--------------------------------\nPagamento\nForma de Pagamento: DINHEIRO\n--------------------------------\nSubtotal:               R$ 40,00\nTaxa de entrega:        R$ 10,00\nTotal:                  R$ 50,00\n--------------------------------\n\x1ba\x01Powered By: MyDelivery\n');
  await receipt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptDocument(complete,80)));
  const full = await receipt.webContents.executeJavaScript(`({width:document.body.clientWidth,scroll:document.body.scrollWidth,headings:[...document.querySelectorAll('.heading span')].map(e=>getComputedStyle(e).fontSize),address:getComputedStyle(document.querySelector('.address span')).fontSize})`);
  assert.ok(full.scroll <= full.width + 1);
  assert.equal(full.address,'14px');
  assert.equal(await receipt.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.address')).fontFamily`), await receipt.webContents.executeJavaScript(`getComputedStyle(document.body).fontFamily`));
  assert.equal(full.headings.length,5);
  assert.ok(full.headings.every(size=>size==='20px'));
  fs.writeFileSync(path.join(output,'complete-80mm.png'),(await receipt.webContents.capturePage()).toPNG());
  await receipt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptDocument(complete,58)));
  const compact = await receipt.webContents.executeJavaScript(`({width:document.body.clientWidth,scroll:document.body.scrollWidth,size:getComputedStyle(document.querySelector('.address span')).fontSize})`);
  assert.ok(compact.scroll <= compact.width + 1); assert.equal(compact.size,'12.5px');
  fs.writeFileSync(path.join(output,'complete-58mm.png'),(await receipt.webContents.capturePage()).toPNG());
  const longCustomer = complete.toString('ascii').replace('Nome: Cliente Teste','Nome: Cliente Teste Com Sobrenome Muito Longo Para Conferencia');
  for (const width of [58,80]) {
    await receipt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptDocument(Buffer.from(longCustomer),width)));
    const bounds = await receipt.webContents.executeJavaScript(`(() => {
      const body=document.body.getBoundingClientRect(), style=getComputedStyle(document.body);
      return {width:body.width,bodyFont:style.fontSize,nameFont:getComputedStyle(document.querySelector('.customer span')).fontSize,
        spans:[...document.querySelectorAll('.line span')].map(el=>({text:el.textContent,right:el.getBoundingClientRect().right,scroll:el.scrollWidth,width:el.clientWidth})),
        safeRight:body.right-parseFloat(style.paddingRight)};
    })()`);
    assert.ok(bounds.width <= (width === 58 ? 48 : 72)*96/25.4 + 1);
    assert.equal(bounds.nameFont,bounds.bodyFont,'Names wrap without shrinking the approved body type');
    assert.ok(bounds.spans.every(span=>span.right<=bounds.safeRight+1),JSON.stringify(bounds));
    assert.ok(bounds.spans.filter(span=>/^R\$/.test(span.text)).every(span=>span.scroll<=span.width+1),'Prices retain all cents inside the print area');
    fs.writeFileSync(path.join(output,`safe-width-${width}mm.png`),(await receipt.webContents.capturePage()).toPNG());
  }
  const talentos = Buffer.from('Cliente\nNome: Cliente Teste\nEntrega: Rua de Teste, 123 - Parque Jair\nItens\n(1) Media R$ 37,00\n  + Frango Com Catupiry (R$ 18,50)\n  + Calabresa (R$ 18,50)\nPagamento\nSubtotal: R$ 37,00\nTaxa de entrega: R$ 10,00\nTotal: R$ 47,00\n');
  for (const width of [58,80]) {
    await receipt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptDocument(talentos,width)));
    const prices = await receipt.webContents.executeJavaScript(`(() => {
      const body=document.body.getBoundingClientRect(), style=getComputedStyle(document.body);
      return [...document.querySelectorAll('.amount-row>span:last-child')].map(el=>({text:el.textContent,gutter:body.right-parseFloat(style.paddingRight)-el.getBoundingClientRect().right,width:el.clientWidth,scroll:el.scrollWidth}));
    })()`);
    assert.equal(prices.length,6);
    assert.deepEqual(prices.map(p=>p.text),['R$ 37,00','(R$ 18,50)','(R$ 18,50)','R$ 37,00','R$ 10,00','R$ 47,00']);
    assert.ok(prices.every(p=>p.gutter >= (width === 58 ? 1 : 2)*96/25.4-1 && p.scroll<=p.width+1),JSON.stringify(prices));
    fs.writeFileSync(path.join(output,`talentos-prices-${width}mm.png`),(await receipt.webContents.capturePage()).toPNG());
  }
  for (const width of [58,80]) {
    await receipt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptDocument(kitchenReceipt(complete),width)));
    const kitchen = await receipt.webContents.executeJavaScript('({text:document.body.innerText,width:document.body.clientWidth,scroll:document.body.scrollWidth})');
    for (const text of ['PARA ENTREGA','Pedido 12345','Pizza Tradicional Pequena','Frango com Catupiry','Refrigerante 1 L','Coca-Cola Original']) assert.ok(kitchen.text.includes(text),text);
    for (const text of ['Cliente Teste','Telefone:','Entrega:','Pagamento','DINHEIRO','R$','Total:','Subtotal:']) assert.ok(!kitchen.text.includes(text),text);
    assert.ok(kitchen.scroll <= kitchen.width + 1);
    const itemFonts = await receipt.webContents.executeJavaScript('[...document.querySelectorAll(".preparation span")].map(el=>getComputedStyle(el).fontSize)');
    assert.ok(itemFonts.length > 0 && itemFonts.every(size=>size === (width === 58 ? "12.5px" : "15.5px")));
    fs.writeFileSync(path.join(output,`kitchen-${width}mm.png`),(await receipt.webContents.capturePage()).toPNG());
  }
  receipt.destroy(); clearTimeout(watchdog);
  console.log('PRINT RENDER PASS: settings/preload, persisted selection, receipt document and PDF; output:',output);
  app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(watchdog);app.exit(1);});
