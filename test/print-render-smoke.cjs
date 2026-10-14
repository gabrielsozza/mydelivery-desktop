// Exercises the actual Chromium renderer and preload without printing paper,
// connecting to a restaurant or changing the user's printer preferences.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { receiptDocument } = require('../receipt-document');
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
  const receipt = new BrowserWindow({show:false,width:420,height:1200,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
  await receipt.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(receiptDocument(require('./fixtures/receipt.json'))));
  const pdf = await receipt.webContents.printToPDF({printBackground:true,pageSize:'A4'});
  assert.ok(pdf.length > 5000);
  fs.writeFileSync(path.join(output,'receipt.pdf'),pdf);
  fs.writeFileSync(path.join(output,'receipt.png'),(await receipt.webContents.capturePage()).toPNG());
  receipt.destroy(); clearTimeout(watchdog);
  console.log('PRINT RENDER PASS: settings/preload, persisted selection, receipt document and PDF; output:',output);
  app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(watchdog);app.exit(1);});
