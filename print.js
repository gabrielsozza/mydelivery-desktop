// Impressão RAW (ESC/POS) direto na impressora do sistema, sem passar pelo
// driver/preview do navegador. Recebe um Buffer de bytes já montado pelo cupom.
//
// - macOS / Linux: usa `lp -o raw` (CUPS). Funciona pra qualquer térmica
//   instalada no sistema. Sem dependência externa.
// - Windows: envia os bytes crus pra fila da impressora compartilhada via
//   `copy /b`. Requer a impressora COMPARTILHADA com o nome informado.
//   (Este caminho é o que vamos calibrar com a impressora real — em alguns
//    modelos trocamos por um módulo nativo depois.)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function tempFile(buffer) {
  const f = path.join(os.tmpdir(), 'md-cupom-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.bin');
  fs.writeFileSync(f, buffer);
  return f;
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, Object.assign({ windowsHide: true }, opts || {}));
    let err = '';
    if (p.stderr) p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error((cmd + ' saiu com código ' + code + (err ? ': ' + err.trim() : ''))));
    });
  });
}

async function imprimirRaw(buffer, printerName) {
  const file = tempFile(buffer);
  try {
    if (process.platform === 'win32') {
      // Impressora compartilhada: copia os bytes crus direto pra fila.
      // printerName = nome do compartilhamento (default: "MyDeliveryPrinter").
      const share = printerName || 'MyDeliveryPrinter';
      const dest = '\\\\localhost\\' + share;
      // cmd /c copy /b "file" "\\localhost\share"
      await run('cmd', ['/c', 'copy', '/b', file, dest]);
    } else {
      // macOS / Linux — CUPS raw.
      const args = ['-o', 'raw'];
      if (printerName) { args.push('-d', printerName); }
      args.push(file);
      await run('lp', args);
    }
  } finally {
    // Limpa o arquivo temporário depois de um tempinho (o spool já leu).
    setTimeout(() => { try { fs.unlinkSync(file); } catch (_) {} }, 8000);
  }
}

module.exports = { imprimirRaw };
