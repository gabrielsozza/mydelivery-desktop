// Impressão RAW (ESC/POS) direto na impressora do sistema, sem passar pelo
// driver/preview do navegador. Recebe um Buffer de bytes já montado pelo cupom.
//
// - macOS / Linux: usa `lp -o raw` (CUPS). Funciona pra qualquer térmica
//   instalada no sistema. Sem dependência externa.
// - Windows: envia os bytes crus pela API do spooler (winspool → WritePrinter)
//   usando o NOME da impressora instalada. NÃO exige impressora compartilhada
//   (o `copy /b \\localhost\share` antigo dava "O nome da rede não foi
//   encontrado" quando a USB não estava compartilhada). Resolve sozinho a
//   impressora padrão do Windows quando nenhum nome é informado.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function tempFile(buffer, ext) {
  const f = path.join(os.tmpdir(), 'md-cupom-' + Date.now() + '-' + Math.random().toString(36).slice(2) + (ext || '.bin'));
  fs.writeFileSync(f, buffer);
  return f;
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, Object.assign({ windowsHide: true }, opts || {}));
    let err = '';
    let out = '';
    if (p.stdout) p.stdout.on('data', d => { out += d.toString(); });
    if (p.stderr) p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error((cmd + ' saiu com código ' + code + ((err || out) ? ': ' + (err || out).trim() : ''))));
    });
  });
}

// Script PowerShell que manda bytes CRUS (RAW) pra impressora pelo spooler do
// Windows via P/Invoke em winspool.drv (OpenPrinter → StartDocPrinter RAW →
// WritePrinter). Funciona com QUALQUER impressora instalada (USB, serial, rede)
// pelo NOME dela — não precisa compartilhamento. Se nenhum nome vier, usa a
// impressora PADRÃO; sem padrão, tenta achar uma térmica pelo nome.
const PS_RAW_PRINT = `
param([string]$FilePath, [string]$PrinterName)
$ErrorActionPreference = 'Stop'
$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOW di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  public static string SendBytes(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero))
      return "OpenPrinter falhou (" + Marshal.GetLastWin32Error() + ")";
    try {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = "MyDelivery Cupom";
      di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, ref di)) return "StartDocPrinter falhou (" + Marshal.GetLastWin32Error() + ")";
      if (!StartPagePrinter(h)) { EndDocPrinter(h); return "StartPagePrinter falhou (" + Marshal.GetLastWin32Error() + ")"; }
      IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
      try {
        Marshal.Copy(bytes, 0, p, bytes.Length);
        int written;
        bool ok = WritePrinter(h, p, bytes.Length, out written);
        if (!ok) return "WritePrinter falhou (" + Marshal.GetLastWin32Error() + ")";
      } finally { Marshal.FreeCoTaskMem(p); }
      EndPagePrinter(h);
      EndDocPrinter(h);
      return "OK";
    } finally { ClosePrinter(h); }
  }
}
"@
Add-Type -TypeDefinition $code -Language CSharp | Out-Null

if (-not $PrinterName -or $PrinterName -eq '') {
  $def = Get-CimInstance -Class Win32_Printer -Filter "Default=True" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($def) { $PrinterName = $def.Name }
  else {
    $all = Get-CimInstance -Class Win32_Printer -ErrorAction SilentlyContinue
    $th = $all | Where-Object { $_.Name -match '(?i)POS|thermal|térmic|termic|receipt|cupom|EPSON TM|TM-|T20|T88|58|80mm|Generic.*Text' } | Select-Object -First 1
    if ($th) { $PrinterName = $th.Name }
    elseif ($all) { $PrinterName = ($all | Select-Object -First 1).Name }
  }
}
if (-not $PrinterName -or $PrinterName -eq '') { Write-Error 'Nenhuma impressora encontrada no Windows'; exit 3 }

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$res = [RawPrinterHelper]::SendBytes($PrinterName, $bytes)
if ($res -eq 'OK') { Write-Output ('Impresso em: ' + $PrinterName); exit 0 }
else { Write-Error ($res + ' [impressora: ' + $PrinterName + ']'); exit 2 }
`;

async function imprimirRawWindows(buffer, printerName) {
  const bin = tempFile(buffer, '.bin');
  const ps1 = tempFile(Buffer.from('\uFEFF' + PS_RAW_PRINT, 'utf8'), '.ps1'); // BOM p/ acentos
  try {
    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', ps1, '-FilePath', bin
    ];
    if (printerName) { args.push('-PrinterName', printerName); }
    await run('powershell.exe', args);
  } finally {
    setTimeout(() => { try { fs.unlinkSync(bin); } catch (_) {} try { fs.unlinkSync(ps1); } catch (_) {} }, 8000);
  }
}

async function imprimirRawUnix(buffer, printerName) {
  const file = tempFile(buffer, '.bin');
  try {
    const args = ['-o', 'raw'];
    if (printerName) { args.push('-d', printerName); }
    args.push(file);
    await run('lp', args);
  } finally {
    setTimeout(() => { try { fs.unlinkSync(file); } catch (_) {} }, 8000);
  }
}

async function imprimirRaw(buffer, printerName) {
  if (process.platform === 'win32') return imprimirRawWindows(buffer, printerName);
  return imprimirRawUnix(buffer, printerName);
}

module.exports = { imprimirRaw };
