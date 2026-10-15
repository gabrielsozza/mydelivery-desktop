'use strict';

// Reflow the legacy 32-column item rows for each destination independently.
// ESC/POS raster payloads are opaque: never split them at embedded LF bytes.
function layoutReceipt(input, width = 80) {
  const bytes = Buffer.from(input), lines = [];
  let start = 0, visible = '', image = false;
  for (let i = 0; i < bytes.length;) {
    if (bytes[i] === 29 && bytes[i + 1] === 118 && bytes[i + 2] === 48) {
      if (i + 8 > bytes.length) throw new Error('Imagem de cupom incompleta.');
      const rasterSize = (bytes[i + 4] + bytes[i + 5] * 256) * (bytes[i + 6] + bytes[i + 7] * 256);
      if (!rasterSize || rasterSize > 256 * 1024) throw new Error('Imagem de cupom inválida.');
      const end = i + 8 + rasterSize;
      if (end > bytes.length) throw new Error('Imagem de cupom incompleta.');
      image = true; i = end; continue;
    }
    if (bytes[i] === 27) { i += bytes[i + 1] === 64 ? 2 : 3; continue; }
    if (bytes[i] === 29 && bytes[i + 1] === 86) { i += [65,66].includes(bytes[i + 2]) ? 4 : 3; continue; }
    if (bytes[i] === 10) {
      lines.push({raw:bytes.subarray(start,i + 1),text:visible,image});
      start = ++i; visible = ''; image = false; continue;
    }
    if (bytes[i] >= 32 && bytes[i] <= 126) visible += String.fromCharCode(bytes[i]);
    i++;
  }
  if (start < bytes.length) lines.push({raw:bytes.subarray(start),text:visible,image});
  const columns = width === 58 ? 32 : 48, compactColumns = width === 58 ? 42 : 64;
  const out = [];
  function row(text, compact, bold) {
    return Buffer.from('\x1ba\0\x1b!' + (compact ? '\x01' : '\0') + '\x1bE' + (bold ? '\x01' : '\0') + text + '\x1b!\0\x1bE\0\n','ascii');
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.image) { out.push(line.raw); continue; }
    if (/^\(\d+(?:[.,]\d+)?\)\s/.test(line.text)) {
      let text = line.text;
      // Old builder placed the amount alone on the following line.
      if (!/R\$\s*[\d.,]+\s*$/.test(text) && lines[i + 1] && !lines[i + 1].image && /^\s*R\$\s*[\d.,]+\s*$/.test(lines[i + 1].text)) text += ' ' + lines[++i].text.trim();
      const match = text.match(/^(.*?)\s+(R\$\s*[\d.,]+)\s*$/);
      if (match) {
        for (let j = 0; j < line.raw.length && line.raw[j] === 27;) {
          const command = line.raw[j + 1], length = command === 64 ? 2 : 3;
          if (command === 64 || command === 116) out.push(line.raw.subarray(j,j + length));
          j += length;
        }
        let name = match[1].trim(), amount = match[2];
        const compact = name.length + amount.length + 1 > columns;
        const limit = compact ? compactColumns : columns;
        // Exceptionally long names retain all information; the amount stays
        // with the final name segment instead of becoming an orphan row.
        const available = Math.max(1,limit - amount.length - 1);
        while (name.length > available) {
          let cut = name.lastIndexOf(' ', available);
          if (cut < 1) cut = available;
          out.push(row(name.slice(0,cut),compact,true)); name = name.slice(cut).trimStart();
        }
        out.push(row(name + ' '.repeat(Math.max(1,limit - name.length - amount.length)) + amount,compact,true));
        continue;
      }
    }
    if (/^\s+\+ /.test(line.text) && line.text.length > columns && line.text.length <= compactColumns) {
      out.push(row(line.text,true,false)); continue;
    }
    out.push(line.raw);
  }
  return Buffer.concat(out);
}

// Converts the ESC/POS subset emitted by MyDelivery into an inert document for
// the OS driver. Keep the same receipt content, including fiscal raster QR codes.
function receiptDocument(input, width = 80) {
  const bytes = layoutReceipt(input, width);
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('Cupom vazio ou grande demais.');
  width = width === 58 ? 58 : 80;
  let align = 'left', bold = false, size = 0, line = '', text = '', output = '', units = 0;
  const escape = value => value.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function flushText() {
    if (!text) return;
    units += text.length * (size & 0x20 ? 24 / 12.5 : 1);
    line += `<span style="font-weight:${bold ? 900 : 700};font-size:${size & 0x20 ? 24 : 12.5}px;line-height:${size & 0x10 ? 2 : 1.3};-webkit-text-stroke:${bold ? 0.18 : 0}px">${escape(text)}</span>`;
    text = '';
  }
  function flushLine() {
    flushText();
    // Separators should fill the paper, not wrap into two lines on 58 mm rolls.
    const plain = line.replace(/<[^>]*>/g, '');
    const item = plain.match(/^(\(\d+(?:[.,]\d+)?\)\s.*?)\s+(R\$\s*[\d.,]+)\s*$/);
    if (item) {
      // Spaces align native fixed-width fonts; driver rows use two columns.
      units = item[1].length + item[2].length + 1;
      line = '<span style="font-weight:900;font-size:12.5px;-webkit-text-stroke:0.18px">' + item[1] + '</span> <span style="font-weight:900;font-size:12.5px;-webkit-text-stroke:0.18px">' + item[2] + '</span>';
    }
    // Match the available paper width without wrapping prices or clipping text.
    const usablePx = (width - (width === 58 ? 4 : 8)) * 96 / 25.4;
    const scale = Math.min(1, usablePx / Math.max(1, units * 7.6));
    if (scale < 1) line = line.replace(/font-size:([\d.]+)px/g, (_, px) => 'font-size:' + (Number(px) * scale).toFixed(3) + 'px');
    output += /^[-=]{8,}$/.test(plain)
      ? `<div class="separator" style="border-top-style:${plain[0] === '=' ? 'double' : 'dashed'}"></div>`
      : `<div class="line" style="text-align:${align};${item ? 'display:flex;justify-content:space-between' : ''}">${line || '<br>'}</div>`;
    line = ''; units = 0;
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
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Cupom MyDelivery</title><style>@page{margin:0}*{box-sizing:border-box}html,body{margin:0;background:white;color:black}body{width:${width}mm;padding:3mm ${width === 58 ? 2 : 4}mm;font-family:'Courier New',monospace;font-size:12.5px;font-weight:700}.line{white-space:pre;min-height:1.25em}.separator{border-top:2px solid black;margin:5px 0}svg{break-inside:avoid}</style></head><body>${output}</body></html>`;
}

// Native thermal fonts have discrete sizes. Keep their column width and use
// emphasis for body text plus double-strike for headings, rather than doubling
// every character. Raster data (including fiscal QR) must remain byte-identical.
function thermalReceipt(input, width = 80) {
  const bytes = layoutReceipt(input, width), out = [27, 69, 1];
  for (let i = 0; i < bytes.length;) {
    if (bytes[i] === 29 && bytes[i + 1] === 118 && bytes[i + 2] === 48) {
      if (i + 8 > bytes.length) throw new Error('Imagem de cupom incompleta.');
      const size = (bytes[i + 4] + bytes[i + 5] * 256) * (bytes[i + 6] + bytes[i + 7] * 256);
      const end = i + 8 + size;
      if (end > bytes.length) throw new Error('Imagem de cupom incompleta.');
      for (; i < end; i++) out.push(bytes[i]);
    } else if (bytes[i] === 27 && bytes[i + 1] === 64) {
      out.push(27, 64, 27, 69, 1); i += 2;
    } else if (bytes[i] === 27 && bytes[i + 1] === 69 && i + 2 < bytes.length) {
      out.push(27, 69, 1, 27, 71, bytes[i + 2] & 1); i += 3;
    } else if (bytes[i] === 27 && bytes[i + 1] === 33 && i + 2 < bytes.length) {
      out.push(27, 33, bytes[i + 2] | 8); i += 3;
    } else {
      out.push(bytes[i++]);
    }
  }
  out.push(27, 71, 0, 27, 69, 0);
  return Buffer.from(out);
}

module.exports = { receiptDocument, thermalReceipt, layoutReceipt };
