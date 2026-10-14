'use strict';

// Converts the ESC/POS subset emitted by MyDelivery into an inert document for
// the OS driver. Keep the same receipt content, including fiscal raster QR codes.
function receiptDocument(input, width = 80) {
  const bytes = Buffer.from(input);
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('Cupom vazio ou grande demais.');
  width = width === 58 ? 58 : 80;
  let align = 'left', bold = false, size = 0, line = '', text = '', output = '';
  const escape = value => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function flushText() {
    if (!text) return;
    line += `<span style="font-weight:${bold ? 700 : 400};font-size:${size & 0x20 ? 22 : 11}px;line-height:${size & 0x10 ? 2 : 1.25}">${escape(text)}</span>`;
    text = '';
  }
  function flushLine() {
    flushText();
    output += `<div class="line" style="text-align:${align}">${line || '<br>'}</div>`;
    line = '';
  }
  function need(i, n) { if (i + n > bytes.length) throw new Error('Cupom incompleto. Tente imprimir novamente.'); }
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    if (b === 10) { flushLine(); continue; }
    if (b === 13) continue;
    if (b === 27) {
      need(i, 1); const command = bytes[i++]; flushText();
      if (command === 0x40) { align = 'left'; bold = false; size = 0; continue; }
      need(i, 1); const value = bytes[i++];
      if (command === 0x61) { align = ['left', 'center', 'right'][value % 48] || 'left'; }
      else if (command === 0x45) bold = !!(value & 1);
      else if (command === 0x21) size = value;
      else if (command !== 0x74) throw new Error('Formato de cupom não suportado pelo driver. Use o modo térmico direto.');
      continue;
    }
    if (b === 29) {
      need(i, 1); const command = bytes[i++];
      if (command === 0x56) { need(i, 1); const mode = bytes[i++]; if (mode === 65 || mode === 66) { need(i, 1); i++; } continue; }
      if (command !== 0x76) throw new Error('Comando de cupom não suportado pelo driver.');
      need(i, 6);
      if (bytes[i++] !== 0x30) throw new Error('Imagem de cupom inválida.');
      const mode = bytes[i++];
      if (mode !== 0 && mode !== 48) throw new Error('Escala de imagem de cupom não suportada.');
      const stride = bytes[i++] + bytes[i++] * 256, height = bytes[i++] + bytes[i++] * 256;
      if (!stride || !height || stride * height > 256 * 1024) throw new Error('Imagem de cupom inválida.');
      need(i, stride * height);
      if (line || text) flushLine();
      let pixels = '';
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < stride * 8; x++) {
          if (bytes[i + y * stride + (x >> 3)] & (128 >> (x & 7))) pixels += `M${x} ${y}h1v1h-1z`;
        }
      }
      output += `<div style="text-align:${align}"><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR Code da nota fiscal" viewBox="0 0 ${stride * 8} ${height}" style="width:38mm;max-width:100%;height:auto;shape-rendering:crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${pixels}" fill="black"/></svg></div>`;
      i += stride * height; continue;
    }
    if (b < 32 || b > 126) throw new Error('Codificação de cupom não suportada pelo driver.');
    text += String.fromCharCode(b);
  }
  if (text || line) flushLine();
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Cupom MyDelivery</title><style>@page{margin:0}*{box-sizing:border-box}html,body{margin:0;background:white;color:black}body{width:${width}mm;padding:3mm 4mm;font-family:'Courier New',monospace;font-size:11px}.line{white-space:pre-wrap;overflow-wrap:anywhere;min-height:1.25em}svg{break-inside:avoid}</style></head><body>${output}</body></html>`;
}

module.exports = { receiptDocument };
