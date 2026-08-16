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
  versao: '1.0.13',

  // Recebe os bytes ESC/POS (array de números) já montados pelo cupom e manda
  // pra impressora padrão (ou a escolhida). Retorna { ok, motivo }.
  imprimir: (bytes, printerName) =>
    ipcRenderer.invoke('md:imprimir', { bytes: Array.from(bytes || []), printerName: printerName || null }),

  listarImpressoras: () => ipcRenderer.invoke('md:listar-impressoras'),

  // Deixa a página forçar o zoom padrão se precisar (ex.: botão "resetar zoom").
  setZoom: (f) => { try { webFrame.setZoomFactor(Number(f) || ZOOM); } catch (_) {} }
});
