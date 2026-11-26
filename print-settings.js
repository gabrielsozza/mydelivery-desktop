'use strict';
const api = window.myDeliveryDesktop;
const printer = document.querySelector('#printer'), width = document.querySelector('#width'), mode = document.querySelector('#mode');
const status = document.querySelector('#status'), note = document.querySelector('#virtual-note');
const kitchen = document.querySelector('#kitchen'), kitchenWidth = document.querySelector('#kitchen-width'), kitchenMode = document.querySelector('#kitchen-mode');
let printers = [];let extras=[];
function renderExtras(){
 const root=document.querySelector('#extra-printers');root.replaceChildren();
 extras.forEach((extra,index)=>{
  const card=document.createElement('section');card.className='section extra-printer';
  const head=document.createElement('div');head.className='extra-head';const title=document.createElement('h2');title.textContent='Impressora '+(index+3);head.append(title);const remove=document.createElement('button');remove.type='button';remove.textContent='Remover';remove.onclick=()=>{extras.splice(index,1);renderExtras();};head.append(remove);card.append(head);
  function select(label,key,options){const l=document.createElement('label');if(key==='receipt') l.className='copy-content';l.textContent=label;const field=document.createElement('select');for(const [v,text] of options){const o=document.createElement('option');o.value=v;o.textContent=text;field.append(o);}field.value=extra[key];field.onchange=()=>{extra[key]=key==='width'?Number(field.value):field.value;};l.append(field);card.append(l);}
  const available=printers.map(p=>[p.name,p.displayName||p.name]);if(extra.printerName&&!printers.some(p=>p.name===extra.printerName))available.push([extra.printerName,extra.printerName+' (não encontrada)']);
  select('Impressora','printerName',[['','Selecione uma impressora'],...available]);select('Conteúdo do cupom','receipt',[['kitchen','Itens e observações para preparo'],['full','Completa com endereço']]);select('Papel','width',[[80,'80 mm'],[58,'58 mm']]);select('Como imprimir','mode',[['auto','Automático (cupom legível pelo driver)'],['driver','Pelo driver do sistema'],['raw','Térmica direta — ESC/POS']]);root.append(card);
 });document.querySelector('#add-printer').disabled=!printers.length;
}
document.querySelector('#add-printer').onclick=()=>{extras.push({printerName:'',width:80,mode:'auto',receipt:'kitchen'});renderExtras();};
const setupKind = document.querySelector('#setup-kind');
const fiscalSelect = document.querySelector('#fiscal');
const channels = document.querySelector('#order-copies');
function showSetup() {
  const sectors = setupKind.value === 'sectors';
  document.querySelector('#second-printer').hidden = setupKind.value === 'single';
  document.querySelector('#extra-devices').hidden = !sectors;
  document.querySelector('.sectors').hidden = !sectors;
  channels.hidden = !fiscalSelect.value;
  document.body.classList.toggle('routing-on',sectors && document.querySelector('#station-on').checked);
}
setupKind.onchange = () => {
  if (setupKind.value === 'sectors' && !document.querySelector('#station-on').disabled) {
    document.querySelector('#station-on').checked = true;
    document.querySelector('#station-on').dispatchEvent(new Event('change'));
  }
  showSetup();
};
fiscalSelect.addEventListener('change',showSetup);
let automaticPrinter = '';
function message(text, error = false) { status.textContent = text; status.className = error ? 'error' : 'success'; }
function busy(value) { document.querySelectorAll('button').forEach(button => { button.disabled = value; }); }
function explain() {
  const selected = printers.find(p => p.name === (printer.value || automaticPrinter));
  const name = selected ? selected.name : '';
  const virtual = /onenote|print to pdf|xps|fax/i.test(name);
  note.hidden = !virtual;
  note.textContent = /onenote/i.test(name)
    ? 'Os pedidos serão enviados para o OneNote. Abra o OneNote uma vez e conclua a configuração inicial antes de testar. Ele pode pedir o bloco de anotações de destino.'
    : 'Esta opção salva ou envia documentos digitalmente. O Windows poderá pedir um nome de arquivo ou destino.';
  if (virtual) mode.value = 'driver';
  mode.querySelector('option[value="raw"]').disabled = virtual;
  document.querySelector('#kitchen-options').hidden = !kitchen.value;
  const kitchenVirtual = /onenote|print to pdf|xps|fax/i.test(kitchen.value);
  if (kitchenVirtual) kitchenMode.value = 'driver';
  kitchenMode.querySelector('option[value="raw"]').disabled = kitchenVirtual;
  const kitchenNote = document.querySelector('#kitchen-note');
  kitchenNote.hidden = !kitchenVirtual;
  kitchenNote.textContent = /onenote/i.test(kitchen.value) ? 'Abra o OneNote e conclua a configuração inicial neste computador antes de testar.' : 'O Windows poderá solicitar o arquivo ou destino digital.';
}
async function load() {
  busy(true);
  try {
    const result = await api.configurarImpressora('load');
    if (!result.ok) throw new Error(result.motivo);
    printers = result.printers; automaticPrinter = result.automaticPrinter || ''; printer.replaceChildren();
    const system = document.createElement('option'); system.value = ''; system.textContent = automaticPrinter ? 'Automática — ' + automaticPrinter : 'Automática (nenhuma disponível)'; printer.append(system);
    printers.forEach(p => { const option = document.createElement('option'); option.value = p.name; option.textContent = p.displayName || p.name; if (p.isDefault) option.textContent += ' (padrão)'; printer.append(option); });
    if (result.settings.printerName && !printers.some(p => p.name === result.settings.printerName)) {
      const missing = document.createElement('option'); missing.value = result.settings.printerName; missing.textContent = result.settings.printerName + ' (não encontrada)'; printer.append(missing);
    }
    document.querySelector('#main-receipt').value = result.settings.mainReceipt || 'full';
    document.querySelector('#kitchen-receipt').value = result.settings.kitchen?.receipt || 'auto';
    printer.value = result.settings.printerName; width.value = String(result.settings.width); mode.value = result.settings.mode;
    kitchen.replaceChildren();
    const disabled = document.createElement('option'); disabled.value = ''; disabled.textContent = 'Não enviar uma segunda cópia'; kitchen.append(disabled);
    printers.forEach(p => { const option = document.createElement('option'); option.value = p.name; option.textContent = p.displayName || p.name; kitchen.append(option); });
    const savedKitchen = result.settings.kitchen;
    if (savedKitchen && !printers.some(p => p.name === savedKitchen.printerName)) {
      const missing = document.createElement('option'); missing.value = savedKitchen.printerName; missing.textContent = savedKitchen.printerName + ' (não encontrada)'; kitchen.append(missing);
    }
    kitchen.value = savedKitchen ? savedKitchen.printerName : '';
    kitchenWidth.value = String(savedKitchen ? savedKitchen.width : 80); kitchenMode.value = savedKitchen ? savedKitchen.mode : 'auto';
    extras=(result.settings.extras||[]).map(x=>({...x}));renderExtras();
    const fiscal = document.querySelector('#fiscal');
    fiscal.replaceChildren(new Option('Desativada', ''));
    for (const p of printers) fiscal.add(new Option(p.displayName || p.name, p.name));
    const savedFiscal = result.settings.fiscal;
    if (savedFiscal && !printers.some(p => p.name === savedFiscal.printerName)) fiscal.add(new Option(savedFiscal.printerName+' (não encontrada)', savedFiscal.printerName));
    fiscal.value=savedFiscal?.printerName || '';
    document.querySelector('#fiscal-width').value=String(savedFiscal?.width || 80);
    document.querySelector('#fiscal-status').textContent=result.fiscalStatus || '';
    const testDestination=document.querySelector('#test-dest');
    testDestination.replaceChildren(...printers.map(p=>new Option(p.displayName||p.name,p.name)));
    testDestination.value=printer.value || automaticPrinter;
    await stationEditor.load(printers,result.settings);
    setupKind.value = document.querySelector('#station-on').checked || extras.length ? 'sectors' : kitchen.value ? 'pair' : 'single';
    setupKind.disabled=false;
    channels.querySelectorAll('input').forEach(box=>box.checked=!!savedFiscal?.channels?.includes(box.value));
    showSetup();
    printer.disabled = false; explain();
    message(printers.length ? '' : 'Nenhuma impressora encontrada. Instale o driver e clique em Atualizar lista.', !printers.length);
  } catch (error) { message(error.message, true); }
  finally { busy(false); }
}
async function save(test) {
  busy(true); message(test ? 'Enviando teste…' : 'Salvando…');
  try {
    const saved = await api.configurarImpressora('save', { mainReceipt:document.querySelector('#main-receipt').value, routingUpdate:stationEditor.update(setupKind.value === 'sectors'), printerName: printer.value, width: Number(width.value), mode: mode.value, fiscal: document.querySelector('#fiscal').value ? {printerName:fiscalSelect.value,channels:Array.from(channels.querySelectorAll('input:checked'),b=>b.value),width:Number(document.querySelector('#fiscal-width').value)} : null, extras: setupKind.value === 'sectors' ? extras : [], kitchen: setupKind.value !== 'single' && kitchen.value ? { printerName: kitchen.value, width: Number(kitchenWidth.value), mode: kitchenMode.value, receipt:document.querySelector('#kitchen-receipt').value } : null });
    if (!saved.ok) throw new Error(saved.motivo);
    if (test) {
      const result = await api.configurarImpressora('test',{name:document.querySelector('#test-dest').value,direct:document.querySelector('#test-direct').checked});
      if (!result.ok) throw new Error(result.motivo);
      message('Teste enviado para ' + result.printerName + '. Confira o resultado no destino escolhido.');
    } else message('Configuração salva para este computador.');
  } catch (error) { message(error.message, true); }
  finally { busy(false); }
}
printer.addEventListener('change', explain);
kitchen.addEventListener('change', explain);
document.querySelector('#refresh').addEventListener('click', load);
document.querySelector('#save').addEventListener('click', () => save(false));
document.querySelector('#test').addEventListener('click', () => save(true));
load();
