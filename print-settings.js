'use strict';
const api = window.myDeliveryDesktop;
const printer = document.querySelector('#printer'), width = document.querySelector('#width'), mode = document.querySelector('#mode');
const status = document.querySelector('#status'), note = document.querySelector('#virtual-note');
const kitchen = document.querySelector('#kitchen'), kitchenWidth = document.querySelector('#kitchen-width'), kitchenMode = document.querySelector('#kitchen-mode');
let printers = [];
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
    printer.disabled = false; explain();
    message(printers.length ? '' : 'Nenhuma impressora encontrada. Instale o driver e clique em Atualizar lista.', !printers.length);
  } catch (error) { message(error.message, true); }
  finally { busy(false); }
}
async function save(test) {
  busy(true); message(test ? 'Enviando teste…' : 'Salvando…');
  try {
    const saved = await api.configurarImpressora('save', { printerName: printer.value, width: Number(width.value), mode: mode.value, kitchen: kitchen.value ? { printerName: kitchen.value, width: Number(kitchenWidth.value), mode: kitchenMode.value } : null });
    if (!saved.ok) throw new Error(saved.motivo);
    if (test) {
      const result = await api.configurarImpressora('test');
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
