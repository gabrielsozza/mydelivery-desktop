'use strict';
const { receiptAddresses } = require('./receipt-document');

// 203 dpi thermal text is normally 24 dots tall. Rasterize only the address
// at 34 dots for a clearly legible address without ESC/POS's 2x width jump.
function drawAddresses(addresses) {
  return addresses.map(text => {
    const canvas = document.createElement('canvas');
    canvas.width = 576; // 72 mm printable area, with margins on an 80 mm roll.
    let ctx = canvas.getContext('2d');
    const font = '700 34px Arial, sans-serif';
    ctx.font = font;
    const lines = []; let line = '';
    for (const word of text.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width <= 568) { line = next; continue; }
      if (line) lines.push(line);
      line = '';
      for (const ch of word) {
        if (ctx.measureText(line + ch).width > 568) { lines.push(line); line = ''; }
        line += ch;
      }
    }
    if (line) lines.push(line);
    canvas.height = Math.max(1, lines.length) * 43 + 8;
    if (canvas.height > 3500) throw new Error('Endereço muito longo para o cupom.');
    ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000'; ctx.font = font; ctx.textBaseline = 'top';
    lines.forEach((value, i) => ctx.fillText(value, 4, 4 + i * 43));
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const stride = canvas.width / 8;
    const raster = [29,118,48,0,stride & 255,stride >> 8,canvas.height & 255,canvas.height >> 8];
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x += 8) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          if (data[(y * canvas.width + x + bit) * 4] < 160) byte |= 128 >> bit;
        }
        raster.push(byte);
      }
    }
    return raster;
  });
}

async function renderAddressRasters(BrowserWindow, bytes) {
  const addresses = receiptAddresses(bytes);
  if (!addresses.length) return null;
  const win = new BrowserWindow({ show:false, width:600, height:200,
    webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title>Cupom</title>'));
    const rasters = await win.webContents.executeJavaScript('(' + drawAddresses.toString() + ')(' + JSON.stringify(addresses) + ')');
    return new Map(addresses.map((text, i) => [text, Buffer.from(rasters[i])]));
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
module.exports = { renderAddressRasters };
