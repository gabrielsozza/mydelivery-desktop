// Ponte segura entre a página web e o processo nativo.
// Expõe window.myDeliveryDesktop pro sistema web detectar que está rodando
// dentro do app e mandar a impressão pela impressora nativa.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myDeliveryDesktop', {
  isDesktop: true,
  platform: process.platform, // 'win32' | 'darwin'
  versao: '1.0.0',

  // Recebe os bytes ESC/POS (array de números) já montados pelo cupom e manda
  // pra impressora padrão (ou a escolhida). Retorna { ok, motivo }.
  imprimir: (bytes, printerName) =>
    ipcRenderer.invoke('md:imprimir', { bytes: Array.from(bytes || []), printerName: printerName || null }),

  listarImpressoras: () => ipcRenderer.invoke('md:listar-impressoras')
});
