const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { attachWindowRecovery, revealWindow } = require('../window-recovery');

function fixture() {
  const calls = [];
  const contents = new EventEmitter();
  let currentUrl = 'https://mydeliveryfood.com.br/login.html';
  contents.getURL = () => currentUrl;
  contents.mainFrame = {};
  contents.stop = () => calls.push('stop');
  contents.reload = () => calls.push('reload');
  contents.forcefullyCrashRenderer = () => calls.push('crash');
  const win = new EventEmitter();
  Object.assign(win, {
    webContents: contents, destroyed: false, minimized: false,
    isDestroyed: () => win.destroyed,
    isMinimized: () => win.minimized,
    restore: () => { win.minimized = false; calls.push('restore'); },
    show: () => calls.push('show'), focus: () => calls.push('focus'),
    loadFile: (file) => { currentUrl = pathToFileURL(file).href; calls.push(['file', file]); return Promise.resolve(); },
    loadURL: (url) => { calls.push(['load', url]); return Promise.resolve(); }
  });
  const shell = { openExternal: (url) => { calls.push(['external', url]); return Promise.resolve(); } };
  let answer = 0;
  const dialog = { showMessageBox: async (_win, options) => { calls.push(['dialog', options]); return { response: answer }; } };
  const recovery = attachWindowRecovery(win, { appUrl: 'https://mydeliveryfood.com.br/login.html', shell, dialog });
  return { win, contents, calls, recovery, event: { sender: contents, senderFrame: contents.mainFrame }, setUrl: url => { currentUrl = url; }, answer: (value) => { answer = value; } };
}

test('clicking shortcut reveals hidden window, restores minimized window, then focuses', () => {
  const f = fixture();
  revealWindow(f.win);
  assert.deepEqual(f.calls, ['show', 'focus']);
  f.calls.length = 0;
  f.win.minimized = true;
  revealWindow(f.win);
  assert.deepEqual(f.calls, ['restore', 'show', 'focus']);
});

test('destroyed or missing windows are not operated on', () => {
  const f = fixture(); f.win.destroyed = true;
  revealWindow(f.win); revealWindow(null);
  assert.deepEqual(f.calls, []);
});

test('main frame connection failure displays local recovery once', () => {
  const f = fixture();
  f.contents.emit('did-fail-load', {}, -105, 'DNS', 'https://mydeliveryfood.com.br/login.html', true);
  f.contents.emit('did-fail-load', {}, -105, 'DNS', 'https://mydeliveryfood.com.br/login.html', true);
  assert.equal(f.calls.filter(c => Array.isArray(c) && c[0] === 'file').length, 1);
  assert.match(f.calls[1][1], /recovery\.html$/);
});

test('cancelled navigations and subframe errors do not replace working panel', () => {
  const f = fixture();
  f.contents.emit('did-fail-load', {}, -3, 'ABORTED', '', true);
  f.contents.emit('did-fail-load', {}, -105, 'DNS', '', false);
  assert.deepEqual(f.calls, []);
});

test('retry can fail again and still show recovery', () => {
  const f = fixture();
  f.contents.emit('did-fail-load', {}, -105, 'DNS', '', true);
  f.recovery.handle(f.event, 'retry');
  f.contents.emit('did-fail-load', {}, -105, 'DNS', '', true);
  assert.equal(f.calls.filter(c => Array.isArray(c) && c[0] === 'file').length, 2);
});

test('renderer crash retries once then shows recovery without a reload loop', () => {
  const f = fixture();
  f.contents.emit('render-process-gone', {}, { reason: 'crashed' });
  f.contents.emit('render-process-gone', {}, { reason: 'crashed' });
  f.contents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(f.calls.filter(c => c === 'reload').length, 1);
  assert.equal(f.calls.filter(c => Array.isArray(c) && c[0] === 'file').length, 1);
});

test('browser fallback opens official login only from recovery screen', () => {
  const f = fixture(); let prevented = false;
  const e = { preventDefault: () => { prevented = true; } };
  f.contents.emit('will-navigate', e, 'https://mydeliveryfood.com.br/login.html?desktop-browser=1');
  assert.equal(prevented, false);
  f.contents.emit('did-fail-load', {}, -105, 'DNS', '', true);
  f.contents.emit('will-navigate', e, 'https://mydeliveryfood.com.br/login.html?desktop-browser=1');
  assert.equal(prevented, true);
  assert.deepEqual(f.calls.at(-1), ['external', 'https://mydeliveryfood.com.br/login.html']);
});

test('unresponsive page is left intact unless restaurant requests reload', async () => {
  const f = fixture();
  f.win.emit('unresponsive');
  await new Promise(setImmediate);
  assert.equal(f.calls.includes('crash'), false);
  f.answer(1); f.win.emit('unresponsive');
  await new Promise(setImmediate);
  assert.equal(f.calls.includes('crash'), true);
});

test('repeated retry requests navigate the existing window only once', () => {
  const f = fixture();
  f.contents.emit('did-fail-load', {}, -202, 'ERR_CERT_AUTHORITY_INVALID', '', true);
  assert.equal(f.recovery.handle(f.event, 'retry').ok, true);
  assert.equal(f.recovery.handle(f.event, 'retry').ok, false);
  assert.equal(f.calls.filter(c => c[0] === 'load').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'external').length, 0);
});

test('browser fallback survives did-start-navigation before will-navigate', () => {
  const f = fixture();
  f.contents.emit('did-fail-load', {}, -202, 'ERR_CERT_AUTHORITY_INVALID', '', true);
  const url = 'https://mydeliveryfood.com.br/login.html?desktop-browser=1';
  f.contents.emit('did-start-navigation', {}, url, false, true);
  let prevented = false;
  f.contents.emit('will-navigate', { preventDefault() { prevented = true; } }, url);
  assert.equal(prevented, true);
  assert.equal(f.calls.filter(c => c[0] === 'external').length, 1);
});

test('recovery refuses popups and never opens arbitrary external URLs', () => {
  const f = fixture();
  f.contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', '', true);
  assert.equal(f.recovery.blockRecoveryPopup('https://example.com'), true);
  assert.equal(f.recovery.blockRecoveryPopup('https://mydeliveryfood.com.br/login.html'), true);
  assert.equal(f.recovery.blockRecoveryPopup('https://mydeliveryfood.com.br/login.html'), true);
  assert.equal(f.calls.filter(c => c[0] === 'load').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'external').length, 0);
});

test('web pages, child frames and other windows cannot invoke recovery actions', () => {
  const f = fixture();
  assert.equal(f.recovery.handle(f.event, 'retry').ok, false);
  f.contents.emit('did-fail-load', {}, -202, 'ERR_CERT_AUTHORITY_INVALID', '', true);
  assert.equal(f.recovery.handle({...f.event, senderFrame: {}}, 'retry').ok, false);
  assert.equal(f.recovery.handle({...f.event, sender: {}}, 'browser').ok, false);
  assert.equal(f.recovery.handle(f.event, 'status').code, -202);
  assert.match(f.recovery.handle(f.event, 'status').message, /certificado/);
  assert.equal(f.recovery.handle(f.event, 'unknown').ok, false);
});

test('successful load restores normal popup handling and clears retry lock', () => {
  const f = fixture();
  f.contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', '', true);
  f.recovery.handle(f.event, 'retry');
  f.setUrl('https://mydeliveryfood.com.br/login.html');
  f.contents.emit('did-finish-load');
  assert.equal(f.recovery.blockRecoveryPopup('about:blank'), false);
  f.contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', '', true);
  assert.equal(f.recovery.handle(f.event, 'retry').ok, true);
});
