const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

async function boot(gotLock = true) {
  const windows = [];
  const handlers = new Map();
  const app = new EventEmitter();
  let readyCalls = 0, quitCalls = 0;
  Object.assign(app, {
    requestSingleInstanceLock: () => gotLock,
    quit: () => { quitCalls++; },
    isReady: () => true,
    whenReady: () => { readyCalls++; return Promise.resolve(); },
    setLoginItemSettings: () => {}
  });
  class BrowserWindow extends EventEmitter {
    constructor() {
      super(); this.destroyed = false; this.visible = true; this.minimized = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { setWindowOpenHandler() {}, setZoomFactor() {} });
      windows.push(this);
    }
    loadURL() { return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; }
    show() { this.visible = true; }
    focus() { assert.equal(this.destroyed, false); }
  }
  const electron = { app, BrowserWindow, ipcMain: { handle(name, fn) { handlers.set(name, fn); } }, shell: {}, dialog: {}, Menu: { buildFromTemplate: x => x, setApplicationMenu() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), {
    require: (name) => name === 'electron' ? electron : name === './print' ? {} : name.startsWith('./') ? require(path.join(__dirname, '..', name)) : require(name),
    __dirname: path.join(__dirname, '..'), process: { platform: 'win32' }, URL, setTimeout() {}, setInterval() {}
  });
  await new Promise(setImmediate);
  return { app, windows, handlers, readyCalls: () => readyCalls, quitCalls: () => quitCalls };
}

test('secondary process exits without starting another window or updater', async () => {
  const f = await boot(false);
  assert.equal(f.quitCalls(), 1);
  assert.equal(f.readyCalls(), 0);
  assert.equal(f.windows.length, 0);
});

test('shortcut reopens hidden/minimized window without duplicate windows', async () => {
  const f = await boot();
  const win = f.windows[0]; win.visible = false; win.minimized = true;
  f.app.emit('second-instance');
  assert.equal(win.visible, true); assert.equal(win.minimized, false);
  assert.equal(f.windows.length, 1);
});

test('shortcut recreates closed main window instead of touching destroyed object', async () => {
  const f = await boot();
  const win = f.windows[0]; win.destroyed = true; win.emit('closed');
  f.app.emit('second-instance');
  assert.equal(f.windows.length, 2);
  assert.equal(f.windows[1].visible, true);
});
test('print bridge rejects external origins and subframes before reaching the spooler', async () => {
  const f = await boot();
  const handle = f.handlers.get('md:imprimir');
  const foreign = { url:'https://example.com/' };
  assert.equal((await handle({senderFrame:foreign,sender:{mainFrame:foreign}}, {bytes:[65]})).ok,false);
  const child = { url:'https://mydeliveryfood.com.br/pedidos.html' };
  assert.equal((await handle({senderFrame:child,sender:{mainFrame:{}}}, {bytes:[65]})).ok,false);
});
test('print bridge rejects oversized or malformed receipt data', async () => {
  const f = await boot(), frame = {url:'https://mydeliveryfood.com.br/pedidos.html'};
  const event = {senderFrame:frame,sender:{mainFrame:frame}};
  for (const bytes of [[],[-1],[256],['65']]) {
    const result = await f.handlers.get('md:imprimir')(event,{bytes});
    assert.equal(result.ok,false); assert.match(result.motivo,/inválido/);
  }
});
