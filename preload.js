// Ponte segura entre a página web e o processo nativo.
// Expõe window.myDeliveryDesktop pro sistema web detectar que está rodando
// dentro do app e mandar a impressão pela impressora nativa.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

// These controls are wired in the isolated preload and accepted by the main
// process only from its own local recovery document, never from a web page.
window.addEventListener('DOMContentLoaded', () => {
  if (window.location.protocol !== 'file:' || !window.location.pathname.endsWith('/recovery.html')) return;
  const retry = document.getElementById('retry-panel');
  const browser = document.getElementById('open-browser');
  if (!retry || !browser) return;
  retry.addEventListener('click', async () => {
    if (retry.disabled) return;
    retry.disabled = true; retry.textContent = 'Conectando…';
    try {
      const result = await ipcRenderer.invoke('md:recovery', 'retry');
      if (result.ok) return;
    } catch (_) {}
    retry.disabled = false; retry.textContent = 'Tentar novamente';
  });
  browser.addEventListener('click', async () => {
    browser.disabled = true;
    try { await ipcRenderer.invoke('md:recovery', 'browser'); } catch (_) {}
    browser.disabled = false;
  });
  ipcRenderer.invoke('md:recovery', 'status').then(result => {
    if (!result.ok || result.code == null) return;
    document.getElementById('failure-detail').textContent = result.message;
    document.getElementById('failure-code').textContent = 'Código para o suporte: ' + (result.description || 'CONNECTION_FAILED') + ' (' + result.code + ')';
  }).catch(() => {});
});

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
  versao: '1.0.42',

  // Recebe os bytes ESC/POS (array de números) já montados pelo cupom e manda
  // pra impressora padrão (ou a escolhida). Retorna { ok, motivo }.
  imprimir: (bytes, printerName, context) =>
    ipcRenderer.invoke('md:imprimir', { bytes: Array.from(bytes || []), printerName: printerName || null, restaurantSlug: context && context.restaurantSlug }),

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
