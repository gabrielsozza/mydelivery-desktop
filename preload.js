// Ponte segura entre a página web e o processo nativo.
// Expõe window.myDeliveryDesktop pro sistema web detectar que está rodando
// dentro do app e mandar a impressão pela impressora nativa.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// ── Zoom padrão do app = 75% (igual marcar "75%" no navegador) ──────────────
// Setar via webFrame AQUI no preload é o jeito confiável no Electron: roda no
// processo renderer, antes da página desenhar, então NÃO sofre o bug de timing
// do webContents.setZoomFactor no processo principal (que ficava sem efeito).
// Reaplica em cada evento do ciclo de vida pra nenhuma navegação/reload voltar
// pro 100%.
const ZOOM = 0.75;
function aplicarZoom() { try { webFrame.setZoomFactor(ZOOM); } catch (_) {} }
aplicarZoom();
try {
  window.addEventListener('DOMContentLoaded', aplicarZoom);
  window.addEventListener('load', aplicarZoom);
  window.addEventListener('pageshow', aplicarZoom);
} catch (_) {}

contextBridge.exposeInMainWorld('myDeliveryDesktop', {
  isDesktop: true,
  platform: process.platform, // 'win32' | 'darwin'
  versao: '1.0.48',
  impressoraFiscalAtiva: async () => !!(await ipcRenderer.invoke('md:fiscal-estado')),
  imprimirNotaFiscal: manualFiscal,
  impressaoCozinhaSomente: true,
  impressaoCaixaSomente: true,

  // Recebe os bytes ESC/POS (array de números) já montados pelo cupom e manda
  // pra impressora padrão (ou a escolhida). Retorna { ok, motivo }.
  imprimir: (bytes, printerName, context) =>
    ipcRenderer.invoke('md:imprimir', {
      bytes: Array.from(bytes || []),
      printerName: printerName || null,
      restaurantSlug: context && context.restaurantSlug,
      target: context && context.target,
      forceKitchenCompact: context && context.forceKitchenCompact === true,
      itemSpans:context?.itemSpans, orderId:context?.orderId, report:context?.report===true
    }),

  testarImpressao: () => ipcRenderer.invoke('md:config-impressora', 'test'),
  listarImpressoras: () => ipcRenderer.invoke('md:listar-impressoras'),
  configurarImpressora: (action, value) => ipcRenderer.invoke('md:config-impressora', action, value),

  // Deixa a página forçar o zoom padrão se precisar (ex.: botão "resetar zoom").
  setZoom: (f) => { try { webFrame.setZoomFactor(Number(f) || ZOOM); } catch (_) {} }
});

// Keep printer selection available in the installed app even when the web
// panel predates this version. The existing native menu provides a fallback.
window.addEventListener('DOMContentLoaded', () => {
  if (window.location.origin !== 'https://mydeliveryfood.com.br' || window.location.pathname !== '/configuracoes.html') return;
  function addPrinterButton() {
    const controls = document.querySelector('#impressora-controles .mdimpr-card');
    if (!controls || controls.querySelector('[data-desktop-printer-settings]')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'mdimpr-btn ghost mdimpr-cta';
    button.dataset.desktopPrinterSettings = 'true'; button.textContent = 'Escolher impressora';
    button.addEventListener('click', () => ipcRenderer.invoke('md:abrir-config-impressora'));
    controls.appendChild(button);
  }
  addPrinterButton();
  const observer = new MutationObserver(addPrinterButton);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
});

// Only the restaurant's main window runs this queue. It follows the signed-in
// session and reads authorizations independently of the order-printing switch.
const fiscalApi = 'https://api.mydeliveryfood.com.br/api/restaurante/fiscal';
async function fiscalRequest(path, token) {
  const response = await fetch(fiscalApi + path, {
    headers: {Authorization:'Bearer '+token}, cache:'no-store', redirect:'error',
    signal:AbortSignal.timeout(25000)
  });
  if (!response.ok) throw Error('Falha ao consultar notas autorizadas (HTTP '+response.status+').');
  return response;
}
function fiscalNote(xml, entry) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const find = (parent, name) => parent?.getElementsByTagNameNS('*', name)[0];
  const val = (parent, name) => find(parent, name)?.textContent?.trim() || '';
  const all = (parent, name) => Array.from(parent?.getElementsByTagNameNS('*',name) || []);
  const info = find(doc,'infNFe'), ide = find(info,'ide'), key = entry.chave || entry.chaveAcesso;
  if (find(doc,'parsererror') || info?.getAttribute('Id') !== 'NFe'+key || val(ide,'mod') !== '65')
    throw Error('O XML recebido não corresponde à NFC-e.');
  const emitter=find(info,'emit'), address=find(emitter,'enderEmit'), buyer=find(info,'dest');
  const totals=find(info,'ICMSTot'), payments=find(info,'pag'), supplement=find(doc,'infNFeSupl');
  return {
    key, environment:val(ide,'tpAmb'), issuer:val(emitter,'xNome'), cnpj:val(emitter,'CNPJ'), ie:val(emitter,'IE'),
    address:['xLgr','nro','xCpl','xBairro','xMun','UF','CEP'].map(k=>val(address,k)).filter(Boolean).join(', '),
    items:all(info,'det').map(d=>{
      const p=find(d,'prod');
      return {code:val(p,'cProd'),name:val(p,'xProd'),unit:val(p,'uCom'),quantity:val(p,'qCom'),price:val(p,'vUnCom'),total:val(p,'vProd')};
    }),
    payments:all(payments,'detPag').map(p=>({type:val(p,'tPag'),label:val(p,'xPag'),amount:val(p,'vPag')})),
    total:val(totals,'vNF'),subtotal:val(totals,'vProd'),delivery:val(totals,'vFrete'),discount:val(totals,'vDesc'),
    extra:val(totals,'vOutro'),change:val(payments,'vTroco'),number:val(ide,'nNF'),series:val(ide,'serie'),
    issued:val(ide,'dhEmi'),consumer:[val(buyer,'xNome'),val(buyer,'CPF')||val(buyer,'CNPJ')].filter(Boolean).join(' · '),
    protocol:val(find(doc,'infProt'),'nProt')||entry.protocolo, qr:val(supplement,'qrCode')||entry.qrCodeUrl,
    lookup:val(supplement,'urlChave'),additional:val(find(info,'infAdic'),'infCpl')
  };
}
async function sendFiscal(entry, token, manual) {
  if (!Number.isSafeInteger(entry.id) || entry.id <= 0) throw Error('Nota fiscal inválida.');
  const response = await fiscalRequest('/notas/'+entry.id+'/xml',token);
  const note = fiscalNote(await response.text(),entry);
  if (localStorage.getItem('token') !== token) throw Error('A conta conectada mudou.');
  const result = await ipcRenderer.invoke('md:fiscal-imprimir',{id:entry.id,note,token,manual});
  if (!result.ok) throw Error(result.motivo);
  return result;
}
async function manualFiscal(pedidoId) {
  try {
    if (!(await ipcRenderer.invoke('md:fiscal-estado'))) return {configurada:false};
    const token=localStorage.getItem('token');
    if (!token || !Number.isSafeInteger(Number(pedidoId)) || Number(pedidoId)<=0) throw Error('Selecione um pedido da loja.');
    const details=await (await fiscalRequest('/pedido/'+Number(pedidoId)+'/dados-fiscais',token)).json();
    if (!details.temNota) throw Error('O pedido ainda não tem NFC-e autorizada.');
    return {configurada:true,...await sendFiscal(details,token,true)};
  } catch (error) { return {configurada:true,ok:false,motivo:error.message}; }
}
if (window.top===window && location.origin==='https://mydeliveryfood.com.br') {
  let after=0, previousToken, stopped=false, timer;
  async function poll() {
    try {
      const token=localStorage.getItem('token');
      if (previousToken!==token) {previousToken=token; after=0;}
      const since=token && await ipcRenderer.invoke('md:fiscal-estado');
      if (!since) {after=0;return;}
      const rows=await (await fiscalRequest('/impressao/pendentes?desde='+since+'&aposId='+after,token)).json();
      for (const row of rows) {
        if (stopped || localStorage.getItem('token')!==token) return;
        try { await sendFiscal(row,token,false); }
        catch (error) { await ipcRenderer.invoke('md:fiscal-aviso','NFC-e: '+error.message); }
        after=row.id;
      }
      if (rows.length<40) after=0;
    } catch (error) {
      if (!stopped) await ipcRenderer.invoke('md:fiscal-aviso',error.message).catch(()=>{});
    } finally { if (!stopped) timer=setTimeout(poll,after?3000:20000); }
  }
  timer=setTimeout(poll,2500);
  window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);},{once:true});
}
