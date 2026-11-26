'use strict';
const stationEditor=(()=>{
  const $=id=>document.getElementById(id);
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
  let catalog, devices=[], rules, stored={}, loaded=false, generation=0;
  function el(tag,text,cls) {
    const n=document.createElement(tag);
    if (text!=null) n.textContent=text;
    if (cls) n.className=cls;
    return n;
  }
  function eligible(){return devices.filter(p=>p.name!==$('fiscal').value);}
  function destination(label,current,empty,change) {
    const field=el('select'); field.setAttribute('aria-label',label);
    field.add(new Option(empty,''));
    for (const p of eligible()) field.add(new Option(p.displayName || p.name,p.name));
    if (current && !eligible().some(p=>p.name===current)) field.add(new Option(current+' (indisponível)',current));
    field.value=current||''; field.onchange=()=>{change(field.value);renderReceipts();};return field;
  }
  function binding(key,id){return value=>{if (value) rules[key][id]=value;else delete rules[key][id];};}
  function row(text,select){
    const r=el('div',null,'station-row');r.append(el('span',text),select);return r;
  }
  function renderReceipts(){
    const rows = $('receipt-rows');
    rows.replaceChildren();
    const targets = new Set([rules.fallback, ...Object.values(rules.categories), ...Object.values(rules.products), ...Object.values(rules.external)]);
    targets.delete('');
    targets.delete($('fiscal').value);
    $('station-receipts').hidden = !targets.size;
    for (const name of [...targets].sort((a,b)=>a.localeCompare(b,'pt-BR'))) {
      const field = el('select');
      field.setAttribute('aria-label','Conteúdo da comanda de '+name);
      field.add(new Option('Somente preparo','kitchen'));
      field.add(new Option('Completa com endereço','full'));
      field.value = rules.receipts[name] || 'kitchen';
      field.onchange = () => { rules.receipts[name] = field.value; };
      rows.append(row(name,field));
    }
  }
  function render(){
    const enabled=$('station-on').checked;
    $('station-fields').hidden=!enabled;
    document.body.classList.toggle('routing-on',enabled);
    if (!enabled || !catalog) return;
    renderReceipts();
    const box=$('station-groups');box.replaceChildren();
    const fallback=destination('Destino dos itens sem regra',rules.fallback,'Solicitar configuração',v=>rules.fallback=v);
    $('station-fallback').replaceChildren(fallback);
    const search=norm($('station-search').value);
    const groups=new Map();
    for (const p of catalog.produtos) {
      if (!groups.has(p.categoriaId)) groups.set(p.categoriaId,{name:p.categoria,products:[]});
      if (p.id) groups.get(p.categoriaId).products.push(p);
    }
    for (const [id,group] of groups){
      const products=norm(group.name).includes(search)?group.products:group.products.filter(p=>norm(p.nome).includes(search));
      if (search && !products.length) continue;
      const section=el('section',null,'station-category');
      section.append(row(group.name,destination('Impressora de '+group.name,rules.categories[id],'Usar destino dos itens sem regra',binding('categories',id))));
      const detail=el('details');detail.open=!!search;
      detail.append(el('summary','Produtos ('+products.length+')'));
      for (const p of products) detail.append(row(p.nome,destination('Impressora de '+p.nome,rules.products[p.id],'Seguir categoria',binding('products',p.id))));
      section.append(detail);box.append(section);
    }
    const external=[...new Set([...catalog.avulsos,...Object.keys(rules.external)])];
    const aliases=new Map();
    external.forEach(n=>{if(!aliases.has(norm(n))) aliases.set(norm(n),n);});
    const matched=[...aliases].filter(([n])=>n.includes(search));
    if (matched.length) {
      const details=el('details',null,'station-imports'); details.open=!!search;
      details.append(el('summary','Itens avulsos e de aplicativos ('+matched.length+')'));
      for (const [key,label] of matched) details.append(row(label,destination('Impressora de '+label,rules.external[key],'Seguir cardápio ou destino sem regra',binding('external',key))));
      box.append(details);
    }
    if (!box.childElementCount) box.append(el('p','Nenhum item encontrado.'));
    $('station-preset').hidden=catalog.slug!=='maria-massas' || !['pizzaria','cozinha','bar','caixa'].every(n=>devices.some(p=>norm(p.name)===n));
  }
  function preset(){
    const byName=n=>devices.find(p=>norm(p.name)===n)?.name;
    const categories={
      'PIZZARIA':['Pizzas de longa fermentação','Pizzas doces'],
      'COZINHA':['Entradas para compartilhar','Pães e caldos','Saladas','Massas da terra','Massas do mar','Sobremesas'],
      'BAR':['Coquetéis','Sucos','Caipirinhas','Drinks sem álcool','Refrigerantes e águas','Doses','Cervejas e chopp']
    };
    for(const p of catalog.produtos) for (const [station,names] of Object.entries(categories))
      if(names.includes(p.categoria)) rules.categories[p.categoriaId]=byName(norm(station));
    for (const item of catalog.avulsos) {
      const key=norm(item);
      if (Object.hasOwn(rules.external,key)) continue;
      const importedKitchen=['Creme de abóbora com carne seca','Monte sua Parmegiana','Nhoque artesanal','Risoto de abóbora com carne de sol','Talharim fresco artesanal'];
      const importedBar=['Coca-Cola Original 1,5l','Coca-Cola sem Açúcar 350ml','Refrigerante Jesus 350ml'];
      if (/^pizza(?:s)?\b/.test(key)) rules.external[key]=byName('pizzaria');
      else if (importedKitchen.some(n=>norm(n)===key)) rules.external[key]=byName('cozinha');
      else if (importedBar.some(n=>norm(n)===key)) rules.external[key]=byName('bar');
    }
    rules.receipts[byName('cozinha')] ??= 'full';
    $('fiscal').value=byName('caixa');$('printer').value=byName('pizzaria');$('printer').dispatchEvent(new Event('change'));
    render();$('station-info').textContent='Distribuição preenchida. Confira os produtos e clique em Salvar.';
  }
  async function load(printers,settings){
    const current=++generation;
    devices=printers;stored=settings.routes||{};loaded=false;catalog=null;$('station-on').disabled=true;
    $('station-fields').hidden=true;$('station-info').textContent='Carregando o cardápio…';
    try {
      const result=await window.myDeliveryDesktop.configurarImpressora('catalog');
      if (current!==generation) return;
      if (!result.ok || !result.catalog) throw Error(result.motivo || 'Abra o painel da loja para carregar o cardápio.');
      catalog=result.catalog;const saved=stored[catalog.slug];
      rules={receipts:Object.assign(Object.create(null),saved?.receipts),categories:{...saved?.categories},products:{...saved?.products},external:{...saved?.external},fallback:saved?.fallback||''};
      loaded=true;$('station-on').checked=!!saved;$('station-on').disabled=false;
      $('station-info').textContent='Cada item segue primeiro a escolha do produto e depois a da categoria.';
      render();
    }catch(error){if(current===generation) $('station-info').textContent=error.message;}
  }
  $('station-on').onchange=render;$('station-search').oninput=render;$('fiscal').addEventListener('change',render);
  $('station-preset').onclick=preset;
  $('station-add').onclick=()=>{
    const field=$('station-name'),name=field.value.trim();
    if (!name) {field.focus();return;}
    if (!catalog.avulsos.some(n=>norm(n)===norm(name))) catalog.avulsos.push(name);
    $('station-search').value=name;field.value='';render();
  };
  return {load,update:(active=true)=>loaded?{slug:catalog.slug,rules:active && $('station-on').checked?rules:null}:null};
})();
