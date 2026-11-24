'use strict';

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
}

function routeItems(input, spans, rules) {
  if (!Array.isArray(spans) || !spans.length) throw Error('Recarregue o painel para imprimir este pedido por setor.');
  const bytes = Buffer.from(input);
  const groups = new Map(), missing = new Set();
  let end = 0;
  for (const item of spans) {
    if (!Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < end || item.end <= item.start || item.end > bytes.length)
      throw Error('Os itens do cupom não puderam ser separados.');
    end = item.end;
    const name = normalizeName(item.name);
    const known = Object.hasOwn(rules.byName,name) ? rules.byName[name] : null;
    const product = item.productId || known?.id;
    const category = item.categoryId || known?.categoryId;
    const dest = (!item.productId && Object.hasOwn(rules.external,name) && rules.external[name]) || rules.products[product] || rules.categories[category] || rules.fallback;
    if (!dest) { missing.add(item.name); continue; }
    if (!groups.has(dest)) groups.set(dest, new Set());
    groups.get(dest).add(item);
  }
  if (missing.size) throw Error('Defina o setor em Configurar impressora para: '+[...missing].slice(0,4).join(', ')+'.');
  const results = new Map();
  for (const [printer,selected] of groups) {
    const parts=[]; let offset=0;
    for (const item of spans) {
      parts.push(bytes.subarray(offset,item.start));
      if (selected.has(item)) parts.push(bytes.subarray(item.start,item.end));
      offset=item.end;
    }
    parts.push(bytes.subarray(offset));
    results.set(printer,Buffer.concat(parts));
  }
  return results;
}

function namedProducts(rows) {
  const names=Object.create(null);
  for (const row of rows) {
    if (!row.id) continue;
    const key=normalizeName(row.nome);
    names[key]=Object.hasOwn(names,key) ? null : {id:row.id,categoryId:row.categoriaId};
  }
  return names;
}

function validateRoutes(rules, printers, fiscal) {
  const names=new Set(printers.map(p=>p.name));
  const targets=new Set([rules.fallback,...Object.values(rules.categories),...Object.values(rules.products),...Object.values(rules.external)].filter(Boolean));
  if (!targets.size) throw Error('Escolha pelo menos uma impressora para os itens do pedido.');
  for (const name of targets) {
    if (!names.has(name)) throw Error('Instale ou substitua a impressora '+name+'.');
    if (name===fiscal?.printerName) throw Error('A impressora da NFC-e é exclusiva. Escolha outro destino para os itens.');
  }
}

module.exports={routeItems,normalizeName,namedProducts,validateRoutes};
