const path = require('path');
const { pathToFileURL } = require('url');
const RECOVERY_URL = pathToFileURL(path.join(__dirname, 'recovery.html')).href;

function recoveryMessage(code) {
  if (code === -202) return 'O Windows não conseguiu validar a autoridade do certificado do site. É necessário verificar os certificados de confiança deste computador.';
  if (code === -201) return 'O certificado foi recusado por data. Confira a data e a hora do Windows; se estiverem corretas, contate o suporte.';
  if (code <= -200 && code >= -299) return 'A conexão segura foi recusada. Contate o suporte com o código abaixo.';
  if (code === -105) return 'O computador não conseguiu localizar o endereço do painel. Confira a conexão e o DNS da rede.';
  if (code === -106) return 'O computador está sem conexão com a internet.';
  if (code === -7 || code === -118) return 'A conexão com o painel demorou além do limite. Tente novamente.';
  return 'Não foi possível concluir a conexão com o painel. Tente novamente ou informe o código abaixo ao suporte.';
}

function revealWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  // focus() alone does not make a hidden window visible.
  win.show();
  win.focus();
}

function attachWindowRecovery(win, { appUrl, shell, dialog }) {
  const contents = win.webContents;
  let recovering = false;
  let crashRecoveries = 0;
  let promptOpen = false;
  let retryPending = false;
  let lastFailure = { code: null, description: '', message: '' };

  function isRecoveryDocument() {
    return contents.getURL() === RECOVERY_URL;
  }

  function retry() {
    if (win.isDestroyed() || retryPending) return false;
    retryPending = true;
    // Explicit native navigation stays in this window, including Ctrl-clicks.
    recovering = false;
    Promise.resolve(win.loadURL(appUrl)).catch(() => {
      retryPending = false;
      showRecovery();
    });
    return true;
  }

  function openBrowser() {
    shell.openExternal(appUrl).catch(() => {});
  }

  function showRecovery() {
    if (win.isDestroyed() || recovering) return;
    recovering = true;
    contents.stop();
    win.loadFile(path.join(__dirname, 'recovery.html')).catch(() => {
      if (!win.isDestroyed()) dialog.showMessageBox(win, {
        type: 'error', title: 'MyDelivery',
        message: 'Não foi possível abrir o painel.',
        detail: 'Feche e abra o MyDelivery novamente. Você também pode acessar mydeliveryfood.com.br/login.html pelo navegador.',
        buttons: ['OK']
      });
    });
  }

  contents.on('did-finish-load', () => {
    retryPending = false;
    if (!isRecoveryDocument()) recovering = false;
  });

  contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    // A cancelled navigation (-3) and failures in subframes are not app failure.
    if (!isMainFrame || code === -3) return;
    retryPending = false;
    lastFailure = { code, description: /^ERR_[A-Z_]+$/.test(description || '') ? description : '', message: recoveryMessage(code) };
    console.error('[MyDelivery connection]', code, lastFailure.description);
    showRecovery();
  });

  contents.on('render-process-gone', (_event, details) => {
    if (win.isDestroyed() || details.reason === 'clean-exit') return;
    // One automatic recovery per app run; repeated crashes must not loop.
    if (!recovering && crashRecoveries++ === 0) {
      contents.reload();
    } else {
      showRecovery();
    }
  });

  // Intercept old recovery links too. did-start-navigation must not clear the
  // recovery flag before will-navigate sees the browser fallback.
  contents.on('will-navigate', (event, url) => {
    if (!recovering && !isRecoveryDocument()) return;
    event.preventDefault();
    if (url === 'https://mydeliveryfood.com.br/login.html?desktop-browser=1') {
      openBrowser();
    } else if (url === appUrl) retry();
  });

  win.on('unresponsive', () => {
    if (promptOpen || win.isDestroyed()) return;
    promptOpen = true;
    dialog.showMessageBox(win, {
      type: 'warning', title: 'MyDelivery',
      message: 'O painel está demorando para responder.',
      detail: 'Você pode aguardar ou recarregar. Alterações ainda não salvas podem ser perdidas ao recarregar.',
      buttons: ['Aguardar', 'Recarregar painel'], defaultId: 0, cancelId: 0
    }).then(({ response }) => {
      if (response === 1 && !win.isDestroyed()) contents.forcefullyCrashRenderer();
    }).catch(() => {}).finally(() => { promptOpen = false; });
  });

  return {
    handle(event, action) {
      if (win.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame || !isRecoveryDocument()) return { ok: false };
      if (action === 'status') return { ok: true, ...lastFailure };
      if (action === 'retry') return { ok: retry() };
      if (action === 'browser') { openBrowser(); return { ok: true }; }
      return { ok: false };
    },
    blockRecoveryPopup(url) {
      if (!recovering && !isRecoveryDocument()) return false;
      if (url === appUrl) retry();
      else if (url === appUrl + '?desktop-browser=1') openBrowser();
      return true;
    }
  };
}

module.exports = { attachWindowRecovery, revealWindow, recoveryMessage };
