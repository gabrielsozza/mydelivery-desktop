const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppUpdater, createUpdateLog } = require('../app-updater');
function setup(choices = [1]) {
  const updater = new EventEmitter(), dialogs = [], installs = [], logs = [];
  let checks = 0, downloads = 0;
  updater.checkForUpdates = async () => { checks++; return { isUpdateAvailable: true }; };
  updater.downloadUpdate = async () => { downloads++; updater.emit('update-downloaded'); return ['verified.exe']; };
  updater.quitAndInstall = (...args) => installs.push(args);
  const controller = createAppUpdater({ updater, log: (...args) => logs.push(args),
    showDialog: async options => { dialogs.push(options); return { response: choices.shift() ?? 1 }; } });
  return { updater, controller, dialogs, installs, logs, checks: () => checks, downloads: () => downloads };
}
test('Later keeps the existing app and disables installation on normal exit', async () => {
  const f = setup(); await f.controller.check();
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.disableDifferentialDownload, true);
  assert.equal(f.installs.length, 0);
  await f.controller.check();
  assert.equal(f.dialogs.length, 1); // no repeated interruption after deferral
  assert.equal(f.downloads(), 1);
});
test('manual check offers the downloaded update again and explicitly restarts', async () => {
  const f = setup([1, 0]); await f.controller.check(); await f.controller.check(true);
  assert.deepEqual(f.installs, [[false, true]]);
  assert.equal(f.checks(), 1); assert.equal(f.updater.autoRunAppAfterInstall, true);
});
test('overlapping checks share download and keep provider listeners intact', async () => {
  const f = setup(); const original = () => {}; f.updater.on('error', original);
  let resolve; f.updater.checkForUpdates = () => new Promise(r => { resolve = r; });
  const a = f.controller.check(), b = f.controller.check(true);
  assert.equal(a, b); resolve({ isUpdateAvailable: true }); await a;
  assert.equal(f.downloads(), 1); assert.equal(f.dialogs.length, 1);
  assert.ok(f.updater.listeners('error').includes(original));
});
test('failed download never installs, remains retryable, manual failure is explained', async () => {
  const f = setup([1]); let attempt = 0;
  f.updater.downloadUpdate = async () => {
    if (!attempt++) { const error = Object.assign(new Error('interrupted'), { code: 'ECONNRESET' }); f.updater.emit('error', error); throw error; }
    f.updater.emit('update-downloaded');
  };
  await f.controller.check(true);
  assert.equal(f.installs.length, 0); assert.equal(f.dialogs[0].type, 'warning');
  await f.controller.check(true); assert.equal(f.dialogs[1].title, 'Atualização pronta');
});
test('automatic network errors leave the working application undisturbed', async () => {
  const f = setup(); f.updater.checkForUpdates = async () => { throw Error('offline'); };
  await f.controller.check(); assert.equal(f.dialogs.length, 0); assert.equal(f.installs.length, 0);
  assert.ok(f.logs.some(x => x[0] === 'check-failed'));
});
test('installer launch error reports failure and allows another attempt', async () => {
  const f = setup([0, 1, 0]); let attempts = 0;
  f.updater.quitAndInstall = () => { if (!attempts++) f.updater.emit('error', Error('launch failed')); };
  await f.controller.check(true); await new Promise(setImmediate);
  assert.equal(f.dialogs[1].type, 'warning');
  await f.controller.check(true); assert.equal(attempts, 2);
});
test('no update does not download or install', async () => {
  const f = setup(); f.updater.checkForUpdates = async () => ({ isUpdateAvailable: false });
  await f.controller.check(true); assert.equal(f.downloads(), 0); assert.equal(f.dialogs[0].title, 'Tudo em dia');
});
test('diagnostics omit messages and sensitive data; logging failures are harmless', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-update-'));
  try {
    const log = createUpdateLog(dir, '1.0.37');
    log('check-failed', { code: 'ECONNRESET', message: 'secret-token-and-user-data' });
    const contents = fs.readFileSync(path.join(dir, 'app-update.log'), 'utf8');
    assert.ok(contents.includes('ECONNRESET')); assert.ok(!contents.includes('secret'));
    const badlog = createUpdateLog(path.join(dir, 'app-update.log', 'not-a-directory'), '1');
    assert.doesNotThrow(() => badlog('error'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
