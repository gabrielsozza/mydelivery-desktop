// Install only after an explicit choice, never during normal exit or Windows shutdown.
function createAppUpdater({ updater, showDialog, log = () => {} }) {
  let checking = null, ready = false, installing = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  // Prefer a complete, checksum-verified installer over patching an older package.
  updater.disableDifferentialDownload = true;
  updater.on('update-downloaded', () => { ready = true; log('download-ready'); });
  updater.on('error', error => {
    log('update-error', error);
    if (installing) {
      installing = false;
      void showFailure().catch(() => {});
    }
  });
  async function showFailure() {
    await showDialog({ type: 'warning', title: 'Atualização não concluída',
      message: 'Não foi possível concluir a atualização.',
      detail: 'O MyDelivery continuará funcionando. Tente novamente em Ajuda → Verificar atualizações. Se o problema continuar, reinstale pelo site mydeliveryfood.com.br.', buttons: ['OK'] });
  }
  async function offerInstall() {
    const choice = await showDialog({ type: 'info', title: 'Atualização pronta',
      message: 'Uma nova versão do MyDelivery está pronta para instalar.',
      detail: 'Salve o que estiver fazendo antes de continuar. Se escolher Depois, nada será instalado ao fechar o aplicativo.',
      buttons: ['Instalar e reiniciar', 'Depois'], defaultId: 1, cancelId: 1 });
    if (choice.response !== 0) { log('install-deferred'); return; }
    installing = true;
    log('install-requested');
    try { updater.quitAndInstall(false, true); }
    catch (error) { installing = false; log('install-error', error); await showFailure(); }
  }
  function check(manual = false) {
    if (checking) return checking;
    if (installing) return Promise.resolve();
    checking = (async () => {
      try {
        if (ready) { if (manual) await offerInstall(); return; }
        log('check-started');
        const result = await updater.checkForUpdates();
        if (!result || !result.isUpdateAvailable) {
          if (manual) await showDialog({ type: 'info', title: 'Tudo em dia', message: 'Você já está na versão mais recente.', buttons: ['OK'] });
          return;
        }
        await updater.downloadUpdate();
        if (ready) await offerInstall();
      } catch (error) {
        log('check-failed', error);
        if (manual) await showFailure().catch(() => {});
      }
    })().finally(() => { checking = null; });
    return checking;
  }
  return { check };
}

// Diagnostics contain only events, version and error codes, never URLs/tokens.
function createUpdateLog(directory, version) {
  const fs = require('fs'), path = require('path');
  const filename = path.join(directory, 'app-update.log');
  return (event, error) => {
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(filename) && fs.statSync(filename).size > 128 * 1024) {
        fs.renameSync(filename, filename + '.previous');
      }
      const code = error && typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : '';
      fs.appendFileSync(filename, JSON.stringify({ time: new Date().toISOString(), version, event, code }) + '\n');
    } catch (_) { /* A diagnostics failure must not prevent opening the app. */ }
  };
}
module.exports = { createAppUpdater, createUpdateLog };
