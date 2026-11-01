const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkLegacyUpdates } = require('../app-updater');

test('legacy background update check performs no network or UI action', async () => {
  const unexpected = () => { throw new Error('Unexpected action'); };
  await checkLegacyUpdates(false, { showDialog: unexpected, openExternal: unexpected });
});
test('legacy manual update opens only the Windows 7 downloads after a click', async () => {
  const opened = [];
  await checkLegacyUpdates(true, { showDialog: async () => ({ response: 1 }), openExternal: url => opened.push(url) });
  assert.deepEqual(opened, []);
  await checkLegacyUpdates(true, { showDialog: async () => ({ response: 0 }), openExternal: url => opened.push(url) });
  assert.deepEqual(opened, ['https://mydeliveryfood.com.br/#app-windows7']);
});
