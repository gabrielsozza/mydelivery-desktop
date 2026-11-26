'use strict';
const qrcode = require('qrcode-generator');

function fiscalDocument(note, width) {
  if (!note || !/^\d{44}$/.test(note.key) || !note.protocol || !Array.isArray(note.items) || !note.items.length) throw Error('Documento fiscal incompleto.');
  const url = new URL(note.qr);
  if (!['http:', 'https:'].includes(url.protocol) || note.qr.length > 2048) throw Error('QR Code fiscal inválido.');
  const qr = qrcode(0, 'M'); qr.addData(note.qr); qr.make();
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => Number(value || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
  const row = (label,value) => '<div class="row"><span>'+escape(label)+'</span><strong>'+escape(value)+'</strong></div>';
  const paymentNames = {'01':'Dinheiro','02':'Cheque','03':'Cartão de crédito','04':'Cartão de débito','05':'Crédito da loja','10':'Vale-alimentação','11':'Vale-refeição','12':'Vale-presente','13':'Vale-combustível','15':'Boleto','16':'Depósito','17':'Pix','18':'Transferência','19':'Fidelidade','20':'Pix','90':'Sem pagamento','99':'Outros'};
  return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>NFC-e '+escape(note.number)+'</title><style>@page{margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}main{width:'+ (width===58?48:68)+'mm;max-width:100%;padding:2mm;margin:0;font:10pt/1.25 Arial,sans-serif;color:black;overflow-wrap:anywhere}.c{text-align:center}.row{display:flex;justify-content:space-between;gap:2mm}.row>span{min-width:0}.row>strong{flex:none;white-space:nowrap}.item{break-inside:avoid;margin:1.5mm 0}hr{border:0;border-top:1px dashed}svg{display:block;width:36mm;height:36mm;margin:auto}.fiscal{break-inside:avoid}small{font-size:8.5pt}</style><main><div class="c"><strong>'+escape(note.issuer)+'</strong><br>CNPJ '+escape(note.cnpj)+' · IE '+escape(note.ie)+'<br>'+escape(note.address)+'<hr><strong>DANFE NFC-e</strong><br>Documento auxiliar da Nota Fiscal de Consumidor Eletrônica</div><hr>'+
    (note.environment==='2'?'<b>HOMOLOGAÇÃO — SEM VALOR FISCAL</b>':'')+note.items.map(i=>'<div class="item"><strong>'+escape(i.code)+' '+escape(i.name)+'</strong>'+row(i.quantity+' '+i.unit+' × '+money(i.price),money(i.total))+'</div>').join('')+
    '<hr>'+row('Qtd. total de itens',note.items.length)+row('Subtotal',money(note.subtotal))+
    [['Desconto',note.discount],['Frete',note.delivery],['Outras despesas',note.extra]].filter(([,v])=>Number(v)>0).map(([k,v])=>row(k,money(v))).join('')+
    row('Valor total',money(note.total))+note.payments.map(p=>row(paymentNames[p.type]||p.label||'Pagamento '+p.type,money(p.amount))).join('')+
    (Number(note.change)>0?row('Troco',money(note.change)):'')+'<hr><div class="c fiscal">'+escape(note.consumer||'Consumidor não identificado')+'<br>NFC-e '+escape(note.number)+' · Série '+escape(note.series)+'<br>'+escape(note.issued)+'<br>Protocolo '+escape(note.protocol)+'<br>'+
    qr.createSvgTag({cellSize:4,margin:16,scalable:true})+'<small>Consulte pela chave de acesso<br>'+escape(note.lookup||url.origin+url.pathname)+'<br>'+escape(note.key.match(/.{4}/g).join(' '))+'</small></div>'+
    (note.additional?'<hr><small>'+escape(note.additional)+'</small>':'')+'</main>';
}
module.exports = { fiscalDocument };
