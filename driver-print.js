'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { orderWithoutInvoice, receiptDocument, thermalReceipt, kitchenReceipt, stationReceipt } = require('./receipt-document');

const { routeItems, validateRoutes } = require('./station-routing');
const { fiscalDocument } = require('./fiscal-document');

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

// Query Chromium's layout tree without enabling scripts inside receipt windows.
async function measuredBox(contents, selector) {
  const inspector=contents.debugger;
  inspector.attach('1.3');
  try {
    const {root}=await inspector.sendCommand('DOM.getDocument');
    const {nodeId}=await inspector.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector});
    const {model}=await inspector.sendCommand('DOM.getBoxModel',{nodeId});
    if (!Number.isFinite(model.height) || model.height<=0) throw Error('Não foi possível medir o cupom.');
    return model;
  } finally { if (inspector.isAttached()) inspector.detach(); }
}

function createPrintingService({ app, BrowserWindow, rawPrint, getContents }) {
  let queue = Promise.resolve();
  let pendingTest;
  const testHeightMm = 40;
  const testBytes = Buffer.from('\x1b@\x1ba\x01MyDelivery\nTeste de impressao\n\n\n\x1dV\x01', 'ascii');
  function settings() {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'printing.json'), 'utf8')); } catch (_) {}
    const fiscal = saved.fiscal && typeof saved.fiscal.printerName === 'string' && saved.fiscal.printerName && Number.isFinite(saved.fiscal.since)
      ? { printerName: saved.fiscal.printerName, width: saved.fiscal.width === 58 ? 58 : 80, since: saved.fiscal.since } : null;
    return { routes: saved.routes || {}, fiscal, printerName: typeof saved.printerName === 'string' ? saved.printerName : '', width: saved.width === 58 ? 58 : 80, mode: ['auto', 'driver', 'raw'].includes(saved.mode) ? saved.mode : 'auto', extras: Array.isArray(saved.extras)?saved.extras.slice(0,2).filter(x=>x&&typeof x.printerName==='string'&&x.printerName).map(x=>({printerName:x.printerName,width:x.width===58?58:80,mode:['auto','driver','raw'].includes(x.mode)?x.mode:'auto',receipt:x.receipt==='full'?'full':'kitchen'})):[], kitchen: saved.kitchen && typeof saved.kitchen.printerName === 'string' && saved.kitchen.printerName ? { printerName: saved.kitchen.printerName, width: saved.kitchen.width === 58 ? 58 : 80, mode: ['auto', 'driver', 'raw'].includes(saved.kitchen.mode) ? saved.kitchen.mode : 'auto' } : null };
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
    const extras = value.extras === undefined ? settings().extras : value.extras;
    if(!Array.isArray(extras)||extras.length>2)throw new Error('Configure no máximo quatro impressoras.');
    for(const extra of extras){
      if(!extra||typeof extra.printerName!=='string'||!extra.printerName||![58,80].includes(extra.width)||!['auto','raw','driver'].includes(extra.mode)||!['full','kitchen'].includes(extra.receipt))throw new Error('Confira as opções das impressoras adicionais.');
      const target=selectPrinter(await list(),extra.printerName);
      if(extra.mode==='raw'&&isVirtual(target.name))throw new Error('Escolha o driver para impressoras virtuais.');
    }
    const routes = {...settings().routes};
    if (value.routingUpdate) {
      const {slug, rules} = value.routingUpdate;
      if (!/^[a-z0-9_-]{1,200}$/i.test(slug)) throw Error('Loja inválida.');
      if (rules) routes[slug] = rules;
      else delete routes[slug];
    }
    const previous = settings().fiscal;
    const requested = value.fiscal === undefined ? previous : value.fiscal;
    let fiscal = null;
    if (requested) {
      if (typeof requested.printerName !== 'string' || !requested.printerName || ![58,80].includes(requested.width)) throw Error('Escolha a impressora e o papel da NFC-e.');
      const selected = selectPrinter(await list(), requested.printerName);
      if (isVirtual(selected.name)) throw Error('Escolha uma impressora física para a NFC-e automática.');
      if (printer.name === selected.name && !Object.keys(routes).length && ![kitchen,...extras].some(t => t && t.printerName !== selected.name))
        throw Error('Selecione outra impressora para os pedidos antes de reservar esta para NFC-e.');
      fiscal = { printerName: selected.name, width: requested.width, since: previous ? previous.since : Date.now() };
    }
    const installed = await list();
    for (const rules of Object.values(routes)) {
      if (rules === value.routingUpdate?.rules) validateRoutes(rules, installed, fiscal);
      else if (fiscal && [rules.fallback,...Object.values(rules.categories),...Object.values(rules.products),...Object.values(rules.external)].includes(fiscal.printerName))
        throw Error('A impressora fiscal também está selecionada em uma distribuição por setor.');
    }
    const file = path.join(app.getPath('userData'), 'printing.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify({ printerName: value.printerName, width: value.width, mode: value.mode, kitchen, extras, fiscal, routes }));
    fs.renameSync(file + '.tmp', file);
    return settings();
  }
  async function sendOne(bytes, config, printer, context) {
    // Talentos pizzas explicitly requested the complete cashier copy in its kitchen.
    const fullKitchen = context && context.restaurantSlug === 'talentos-pizzas'
      && context.forceKitchenCompact !== true;
    const testReceipt = context && context.testReceipt === true;
    if (config.station) bytes = stationReceipt(bytes, printer.name);
    else if (!testReceipt && (config.label === 'Cozinha'||config.receipt==='kitchen') && !fullKitchen) bytes = kitchenReceipt(bytes);
    // The automatic path uses the same large, readable document layout as the
    // browser. Native ESC/POS remains an explicit choice for devices whose
    // driver cannot print a receipt document.
    const nativeStation = config.station && config.mode === 'auto';
    if ((config.mode === 'raw' || nativeStation) && !isVirtual(printer.name)) {
      await rawPrint(testReceipt ? testBytes : thermalReceipt(bytes, config.width, config.station), printer.name);
      return { ok: true, printerName: printer.name, via: 'raw' };
    }
    // OneNote uses the regular driver path, never the thermal RAW spooler.
    const html = testReceipt
      ? `<!doctype html><meta charset="utf-8"><title>Teste MyDelivery</title><style>@page{size:${config.width}mm ${testHeightMm}mm;margin:0}body{margin:4mm;text-align:center;font:12pt/1.4 Arial,sans-serif}</style><b>MyDelivery</b><br>Teste de impressão`
      : receiptDocument(bytes, config.width, config.station);
    const testOptions = testReceipt ? {
      pageSize: { width: config.width * 1000, height: testHeightMm * 1000 },
      pageRanges: [{ from: 0, to: 0 }]
    } : {};
    const printWindow = new BrowserWindow({ show: false, width: 480, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, backgroundThrottling: false } });
    try {
      try { await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)); }
      catch (_) { throw new Error('Não foi possível preparar o cupom para impressão.'); }
      if (!testReceipt) {
        const height = (await measuredBox(printWindow.webContents,'body')).height;
        if (!Number.isFinite(height) || height <= 0) throw Error('Não foi possível medir o cupom.');
        testOptions.pageSize = {width:config.width*1000,height:Math.max(40000,Math.min(500000,Math.ceil(height*25400/96)+6500))};
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('O driver não confirmou o envio. Confira a fila da impressora antes de tentar novamente.')), 45000);
        try {
          printWindow.webContents.print({ silent: true, deviceName: printer.name, ...testOptions, printBackground: true, color: false, margins: { marginType: 'none' }, copies: 1 }, (success, reason) => {
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
  async function send(bytes, explicitName, context) {
    const config = settings(), printers = await list();
    const rules = Object.hasOwn(config.routes,context?.restaurantSlug) && config.routes[context.restaurantSlug];
    if (rules && (context?.report || context?.target === 'cashier')) {
      const mainName=selectPrinter(printers,config.printerName).name;
      const stations=[rules.fallback,...Object.values(rules.categories),...Object.values(rules.products),...Object.values(rules.external)];
      if (mainName===config.fiscal?.printerName || stations.includes(mainName))
        throw Error('A impressora principal está reservada. Escolha uma impressora de relatórios no campo principal para imprimir o fechamento.');
      context={...context,target:'cashier'};
    }
    const routed = rules && !context?.testReceipt && context?.target !== 'cashier' && !context?.report
      ? routeItems(bytes, context?.itemSpans, rules) : null;
    if (!routed && config.fiscal && !context?.testReceipt) bytes = orderWithoutInvoice(bytes);
    const targetMode = context && context.target || 'all';
    let targets;
    if (routed) {
      const configs = [config, config.kitchen, ...config.extras].filter(Boolean);
      targets = Array.from(routed, ([printerName, ticket]) => {
        const device = configs.find(c => c.printerName === printerName);
        return {printerName, width:device?.width || 80, mode:device?.mode || 'auto',
          label:printerName, receipt:'kitchen', station:context.restaurantSlug === 'maria-massas', ticket:orderWithoutInvoice(ticket)};
      });
      context={...context,forceKitchenCompact:true};
    } else if (targetMode === 'kitchen') {
      if (!config.kitchen) throw new Error('Configure a segunda impressora da cozinha no aplicativo MyDelivery.');
      if (config.kitchen.printerName === config.printerName) throw new Error('A impressora da cozinha precisa ser diferente da impressora do caixa.');
      targets = [{ ...config.kitchen, label: 'Cozinha' }];
    } else if (targetMode === 'cashier') {
      // Financial reports belong only at the cashier, even when kitchen and
      // additional printers are configured for normal order receipts.
      targets = [{ ...config, label: 'Caixa' }];
    } else {
      const explicitKitchen = explicitName && config.kitchen && explicitName === config.kitchen.printerName && explicitName !== config.printerName;
      targets = [{ ...(explicitKitchen ? config.kitchen : config), printerName: explicitName || config.printerName, label: explicitKitchen ? 'Cozinha' : 'Caixa' }];
      if (!explicitName && config.kitchen) targets.push({ ...config.kitchen, label: 'Cozinha' });
      if(!explicitName)config.extras.forEach((extra,index)=>targets.push({...extra,label:'Impressora '+(index+3)}));
      if(explicitName){const extra=config.extras.find(x=>x.printerName===explicitName);if(extra)targets[0]={...extra,label:'Impressora adicional'};}
    }
    // Resolve all destinations before sending any copy. Never substitute a
    // missing configured printer with the system default.
    if (config.fiscal && explicitName === config.fiscal.printerName && targetMode === 'all') {
      return send(bytes, null, context);
    }
    const eligible = targets.filter(t => !config.fiscal || t.printerName !== config.fiscal.printerName);
    const resolved = eligible.map(target => ({ ...target, printer: selectPrinter(printers, target.printerName) }));
    const orderTargets = resolved.filter(target => target.printer.name !== config.fiscal?.printerName);
    if (!orderTargets.length) throw Error('Esta impressora está reservada para NFC-e. Confira o destino dos pedidos em Configurar impressora.');
    const unique = orderTargets.filter((target, i) => orderTargets.findIndex(t => t.printer.name === target.printer.name) === i);
    if (unique.length === 1) return sendOne(unique[0].ticket || bytes, unique[0], unique[0].printer, context);
    // Rendering timestamps change on automatic retries. Normalize only exact
    // generated timestamp/ETA spans, leaving all order and fiscal content intact.
    const stable = receiptDocument(bytes).replace(/>(\d{2}\/\d{2}\/\d{4}),? \d{2}:\d{2}(?::\d{2})?<\/span>/g, '>$1 TIMESTAMP</span>')
      .replace(/>Entrega prevista: \d{2}:\d{2} - \d{2}:\d{2}<\/span>/g, '>ETA</span>');
    const key = createHash('sha256').update(stable)
      .update(context && context.restaurantSlug === 'talentos-pizzas' && context.forceKitchenCompact !== true ? 'talentos-pizzas:full-kitchen' : '')
      .update(context?.restaurantSlug || '').update(String(context?.orderId || '')).update(routed ? JSON.stringify([rules.fallback,rules.categories,rules.products,rules.external]) : '')
      .update(targetMode).update(JSON.stringify(unique.map(t => t.printer.name).sort())).digest('hex');
    const now = Date.now(), progress = readProgress();
    for (const [id, entry] of Object.entries(progress)) if (!entry || now - entry.at > 7 * 86400000) delete progress[id];
    const entry = progress[key] || { at: now, sent: [] };
    // Check persistence before any physical side effect.
    writeProgress(progress);
    const failures = [];
    for (const target of unique) {
      if (entry.sent.includes(target.printer.name)) continue;
      try { await sendOne(target.ticket || bytes, target, target.printer, context); }
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
  function print(bytes, name, context) {
    // Do not retry through another printer: a driver error may occur after the
    // spooler accepted a job. The caller retains its existing retry/dedup logic.
    const job = queue.then(() => send(bytes, name, context));
    queue = job.catch(() => {});
    return job;
  }
  function test(name, direct) {
    if (name) {
      if (!pendingTest) {
        const job = queue.then(async () => {
          const printer=selectPrinter(await list(),name);
          const cfg=settings();
          const match=[cfg.fiscal,cfg,cfg.kitchen,...cfg.extras].find(p=>p?.printerName===name);
          return sendOne(testBytes,{width:match?.width || 80,mode:direct?'raw':'driver'},printer,{testReceipt:true});
        });
        queue=job.catch(()=>{});
        pendingTest=job.finally(()=>{pendingTest=undefined;});
      }
      return pendingTest;
    }
    if (!pendingTest) {
      pendingTest = print(testBytes, null, { testReceipt: true }).finally(() => { pendingTest = undefined; });
    }
    return pendingTest;
  }
  function invoice(note, reserve) {
    const job = queue.then(async () => {
      const fiscal = settings().fiscal;
      if (!fiscal) throw Error('Escolha a impressora exclusiva da NFC-e.');
      const printer = selectPrinter(await list(), fiscal.printerName);
      const html = fiscalDocument(note, fiscal.width);
      const paper = new BrowserWindow({show:false, width:480, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
      try {
        await paper.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        const height = (await measuredBox(paper.webContents,'main')).height;
        if (!Number.isFinite(height) || height <= 0) throw Error('Não foi possível medir a NFC-e.');
        if (reserve && !(await reserve())) return {ok:true, ignorado:true};
        await new Promise((resolve,reject) => {
          const timer = setTimeout(() => reject(Error('O driver não confirmou a NFC-e. Confira a fila antes de reimprimir.')),45000);
          paper.webContents.print({silent:true, deviceName:printer.name, copies:1, color:false, printBackground:true, margins:{marginType:'none'},
            pageSize:{width:fiscal.width*1000,height:Math.min(500000,Math.max(40000,Math.ceil(height*25400/96)+3500))}},
            (ok,reason)=>{clearTimeout(timer);if(ok)resolve();else reject(Error(reason || 'Falha ao imprimir a NFC-e.'));});
        });
        return {ok:true, printerName:printer.name};
      } finally { if (!paper.isDestroyed()) paper.destroy(); }
    });
    queue=job.catch(()=>{});
    return job;
  }
  return { settings, save, list, print, test, invoice };
}
module.exports = { measuredBox, createPrintingService, selectPrinter, isVirtual };
