// Run with Electron, using an isolated profile and no OS login registration.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'mydelivery-smoke-')));
app.setLoginItemSettings = () => {};
require('../main');
const watchdog = setTimeout(() => { console.error('SMOKE TIMEOUT'); app.exit(1); }, 45000);
function loaded(win, matches) {
  return new Promise(resolve => {
    function check() {
      if (!matches(win.webContents.getURL())) return;
      win.webContents.removeListener('did-finish-load', check);
      resolve();
    }
    win.webContents.on('did-finish-load', check);
  });
}
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  assert.ok(win, 'main window created');
  win.hide();
  app.emit('second-instance');
  assert.equal(win.isVisible(), true, 'shortcut reveals hidden window');
  const fallbackLoaded = loaded(win, url => /recovery\.html$/.test(url));
  await win.loadURL('http://127.0.0.1:1').catch(() => {});
  await fallbackLoaded;
  assert.match(win.webContents.getURL(), /recovery\.html$/, 'connection failure shows recovery');
  // Exercise the actual isolated preload and recovery controls, not loadURL
  // directly: rapid clicks must not create a new application/browser window.
  const status = await win.webContents.executeJavaScript('document.getElementById("failure-code").textContent');
  assert.match(status, /-312|ERR_UNSAFE_PORT/, 'specific connection error is visible');
  const retryLoaded = loaded(win, url => url === 'https://mydeliveryfood.com.br/login.html');
  await win.webContents.executeJavaScript('document.getElementById("retry-panel").click(); document.getElementById("retry-panel").click();');
  await retryLoaded;
  assert.equal(win.webContents.getURL(), 'https://mydeliveryfood.com.br/login.html', 'retry opens live login');
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'retry keeps one window');
  const again = loaded(win, url => /recovery\.html$/.test(url));
  await win.loadURL('http://127.0.0.1:1').catch(() => {});
  await again;
  const popupRetry = loaded(win, url => url === 'https://mydeliveryfood.com.br/login.html');
  await win.webContents.executeJavaScript('window.open("https://mydeliveryfood.com.br/login.html")');
  await popupRetry;
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'legacy popup retry stays in one window');
  console.log('SMOKE PASS: native window, diagnostic error, repeated retry and popup retry stay in one window');
  clearTimeout(watchdog);
  app.exit(0);
}).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1); });
