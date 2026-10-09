const path = require('path');

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

  contents.on('did-start-navigation', (_event, url, _inPlace, isMainFrame) => {
    if (isMainFrame && /^https?:/.test(url)) recovering = false;
  });

  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    // A cancelled navigation (-3) and failures in subframes are not app failure.
    if (!isMainFrame || code === -3) return;
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

  // The local recovery page uses regular links; no privileged bridge is exposed.
  contents.on('will-navigate', (event, url) => {
    if (!recovering) return;
    if (url === 'https://mydeliveryfood.com.br/login.html?desktop-browser=1') {
      event.preventDefault();
      shell.openExternal(appUrl).catch(() => {});
    }
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
}

module.exports = { attachWindowRecovery, revealWindow };
