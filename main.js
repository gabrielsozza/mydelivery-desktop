// MyDelivery Desktop — processo principal (Electron)
// Abre o painel web (mydeliveryfood.com.br) numa janela de app e expõe uma
// ponte de impressão nativa. NÃO altera nada do sistema web: só carrega a URL.

const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const printModule = require('./print');

// URL do painel do dono. Trocar aqui se um dia mudar o domínio.
const APP_URL = 'https://mydeliveryfood.com.br/login.html';

// Garante instância única — abrir o atalho de novo foca a janela existente
// em vez de abrir duas (evita dois apps imprimindo o mesmo pedido).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win = null;

function criarJanela() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0b',
    title: 'MyDelivery',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL(APP_URL);

  // Links externos (WhatsApp, etc.) abrem no navegador padrão, não dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://mydeliveryfood.com.br')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Menu enxuto (recarregar / sair / devtools). Sem menu bagunçado de Electron.
  const menu = Menu.buildFromTemplate([
    {
      label: 'MyDelivery',
      submenu: [
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
        { label: 'Tela cheia', accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
        { type: 'separator' },
        { label: 'Ferramentas (debug)', accelerator: 'CmdOrCtrl+Shift+I', click: () => win.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' }
      ]
    },
    { label: 'Editar', submenu: [ { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' } ] }
  ]);
  Menu.setApplicationMenu(menu);
}

// ── Ponte de impressão ──────────────────────────────────────────────────
// O web manda os bytes ESC/POS já prontos (o mesmo cupom do WebUSB) e o
// processo nativo envia direto pra impressora padrão do sistema — sem o
// pop-up do navegador, sem o .bat, sem permissão de USB.
ipcMain.handle('md:imprimir', async (_evt, payload) => {
  try {
    const bytes = Array.isArray(payload && payload.bytes) ? payload.bytes : [];
    const printerName = (payload && payload.printerName) || null;
    if (!bytes.length) return { ok: false, motivo: 'sem bytes' };
    await printModule.imprimirRaw(Buffer.from(bytes), printerName);
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e && e.message ? e.message : String(e) };
  }
});

// Lista as impressoras disponíveis (pra o dono escolher a térmica no painel).
ipcMain.handle('md:listar-impressoras', async () => {
  try { return await win.webContents.getPrintersAsync(); }
  catch (e) { return []; }
});

app.whenReady().then(() => {
  // Logo MyDelivery no dock do Mac (também no modo dev). No app empacotado o
  // ícone vem do build/icon.icns (Mac) e build/icon.ico (Windows) via builder.
  try {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'));
    }
  } catch (_) {}

  criarJanela();

  // Iniciar junto com o sistema (dono liga o PC e o app já sobe).
  try {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
  } catch (_) {}

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
