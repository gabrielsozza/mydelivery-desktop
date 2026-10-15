'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { receiptDocument, thermalReceipt } = require('./receipt-document');

const isVirtual = name => /onenote|print to pdf|xps|fax/i.test(name || '');
function selectPrinter(printers, name) {
  if (name) {
    const selected = printers.find(p => p.name === name);
    if (!selected) throw new Error('A impressora salva não está instalada. Abra MyDelivery > Configurar impressora.');
    return selected;
  }
  // Preserve the previous automatic preference for a thermal printer. A
  // Windows update often makes OneNote the default despite a working POS.
  const thermal = p => !isVirtual(p.name) && /POS|thermal|t[eé]rmic|receipt|cupom|EPSON TM|TM-|T20|T88|58|80mm|Generic.*Text/i.test(p.name);
  const selected = printers.find(p => p.isDefault && thermal(p)) || printers.find(thermal) || printers.find(p => p.isDefault) || printers.find(p => !isVirtual(p.name));
  if (!selected) throw new Error('Escolha uma impressora em MyDelivery > Configurar impressora.');
  return selected;
}

function createPrintingService({ app, BrowserWindow, rawPrint, getContents }) {
  let queue = Promise.resolve();
  function settings() {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'printing.json'), 'utf8')); } catch (_) {}
    return { printerName: typeof saved.printerName === 'string' ? saved.printerName : '', width: saved.width === 58 ? 58 : 80, mode: ['auto', 'driver', 'raw'].includes(saved.mode) ? saved.mode : 'auto', kitchen: saved.kitchen && typeof saved.kitchen.printerName === 'string' && saved.kitchen.printerName ? { printerName: saved.kitchen.printerName, width: saved.kitchen.width === 58 ? 58 : 80, mode: ['auto', 'driver', 'raw'].includes(saved.kitchen.mode) ? saved.kitchen.mode : 'auto' } : null };
  }
  async function list() { return getContents().getPrintersAsync(); }
  async function save(value) {
    if (!value || typeof value.printerName !== 'string' || ![58, 80].includes(value.width) || !['auto', 'driver', 'raw'].includes(value.mode)) throw new Error('Configuração de impressão inválida.');
    const printer = selectPrinter(await list(), value.printerName);
    if (value.mode === 'raw' && isVirtual(printer.name)) throw new Error('Para OneNote, PDF ou outra impressora virtual, selecione “Pelo driver do sistema”.');
    let kitchen = null;
    if (value.kitchen != null) {
      const k = value.kitchen;
      if (typeof k.printerName !== 'string' || !k.printerName || ![58, 80].includes(k.width) || !['auto', 'driver', 'raw'].includes(k.mode)) throw new Error('Configuração da cozinha inválida.');
      const destination = selectPrinter(await list(), k.printerName);
      if (k.mode === 'raw' && isVirtual(destination.name)) throw new Error('Na cozinha, selecione o driver do sistema para impressoras virtuais.');
      kitchen = { printerName: k.printerName, width: k.width, mode: k.mode };
    }
    const file = path.join(app.getPath('userData'), 'printing.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify({ printerName: value.printerName, width: value.width, mode: value.mode, kitchen }));
    fs.renameSync(file + '.tmp', file);
    return settings();
  }
  async function sendOne(bytes, config, printer) {
    // Preserve pre-1.0.19 thermal transport unless the owner explicitly chose a driver.
    if ((config.mode === 'raw' || config.mode === 'auto') && !isVirtual(printer.name)) {
      await rawPrint(thermalReceipt(bytes), printer.name);
      return { ok: true, printerName: printer.name, via: 'raw' };
    }
    // OneNote uses the regular driver path, never the thermal RAW spooler.
    const html = receiptDocument(bytes, config.width);
    const printWindow = new BrowserWindow({ show: false, width: 480, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, backgroundThrottling: false } });
    try {
      try { await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); }
      catch (_) { throw new Error('Não foi possível preparar o cupom para impressão.'); }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('O driver não confirmou o envio. Confira a fila da impressora antes de tentar novamente.')), 45000);
        try {
          printWindow.webContents.print({ silent: true, deviceName: printer.name, printBackground: true, color: false, margins: { marginType: 'none' }, copies: 1 }, (success, reason) => {
            clearTimeout(timer);
            if (success) resolve();
            else reject(new Error((reason || 'Falha no driver de impressão.') + (/onenote/i.test(printer.name) ? ' Abra o OneNote uma vez, conclua a configuração inicial e teste novamente.' : ' Confira a conexão e o driver da impressora.')));
          });
        } catch (error) { clearTimeout(timer); reject(error); }
      });
      return { ok: true, printerName: printer.name, via: 'driver' };
    } finally { if (!printWindow.isDestroyed()) printWindow.destroy(); }
  }
  // Only hashes, printer names and timestamps are persisted, never receipt or
  // customer data. Resume a partial two-printer job after reload/restart.
  const progressFile = () => path.join(app.getPath('userData'), 'printing-pending.json');
  function readProgress() {
    try { return JSON.parse(fs.readFileSync(progressFile(), 'utf8')); } catch (_) { return {}; }
  }
  function writeProgress(progress) {
    fs.mkdirSync(path.dirname(progressFile()), { recursive: true });
    fs.writeFileSync(progressFile() + '.tmp', JSON.stringify(progress));
    fs.renameSync(progressFile() + '.tmp', progressFile());
  }
  async function send(bytes, explicitName) {
    const config = settings(), printers = await list();
    const targets = [{ ...config, printerName: explicitName || config.printerName, label: 'Caixa' }];
    if (!explicitName && config.kitchen) targets.push({ ...config.kitchen, label: 'Cozinha' });
    // Resolve all destinations before sending any copy. Never substitute a
    // missing configured printer with the system default.
    const resolved = targets.map(target => ({ ...target, printer: selectPrinter(printers, target.printerName) }));
    const unique = resolved.filter((target, i) => resolved.findIndex(t => t.printer.name === target.printer.name) === i);
    if (unique.length === 1) return sendOne(bytes, unique[0], unique[0].printer);
    // Rendering timestamps change on automatic retries. Normalize only exact
    // generated timestamp/ETA spans, leaving all order and fiscal content intact.
    const stable = receiptDocument(bytes).replace(/>(\d{2}\/\d{2}\/\d{4}),? \d{2}:\d{2}(?::\d{2})?<\/span>/g, '>$1 TIMESTAMP</span>')
      .replace(/>Entrega prevista: \d{2}:\d{2} - \d{2}:\d{2}<\/span>/g, '>ETA</span>');
    const key = createHash('sha256').update(stable).update(JSON.stringify(unique.map(t => t.printer.name).sort())).digest('hex');
    const now = Date.now(), progress = readProgress();
    for (const [id, entry] of Object.entries(progress)) if (!entry || now - entry.at > 7 * 86400000) delete progress[id];
    const entry = progress[key] || { at: now, sent: [] };
    // Check persistence before any physical side effect.
    writeProgress(progress);
    const failures = [];
    for (const target of unique) {
      if (entry.sent.includes(target.printer.name)) continue;
      try { await sendOne(bytes, target, target.printer); }
      catch (error) { failures.push(target.label + ' (' + target.printer.name + '): ' + error.message); continue; }
      entry.sent.push(target.printer.name); entry.at = Date.now(); progress[key] = entry;
      // Persist each accepted destination before sending the next one.
      writeProgress(progress);
    }
    if (failures.length) {
      throw new Error(failures.join(' ') + (entry.sent.length ? ' A cópia já enviada será preservada na próxima tentativa.' : ''));
    }
    delete progress[key]; writeProgress(progress);
    return { ok: true, printerName: unique.map(t => t.printer.name).join(' e '), printers: unique.map(t => t.printer.name), via: 'multiple' };
  }
  function print(bytes, name) {
    // Do not retry through another printer: a driver error may occur after the
    // spooler accepted a job. The caller retains its existing retry/dedup logic.
    const job = queue.then(() => send(bytes, name));
    queue = job.catch(() => {});
    return job;
  }
  return { settings, save, list, print };
}
module.exports = { createPrintingService, selectPrinter, isVirtual };
