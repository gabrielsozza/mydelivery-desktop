// afterPack — assina o app do macOS com assinatura AD-HOC (grátis, sem conta
// Apple paga). Sem uma assinatura VÁLIDA, o macOS (Sequoia) trata o app como
// "Malware Bloqueado" e NÃO oferece "Abrir Mesmo Assim". Com a assinatura
// ad-hoc, o app cai no fluxo normal de "desenvolvedor não identificado", e o
// dono libera em Ajustes → Privacidade e Segurança → Abrir Mesmo Assim.
//
// Roda no CI (macos-latest) logo depois de empacotar o .app e antes de montar
// o DMG, então o instalador já sai com a assinatura correta.
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename + '.app';
  const appPath = path.join(context.appOutDir, appName);

  console.log('[afterPack] assinando ad-hoc:', appPath);
  // --deep assina frameworks/helpers de dentro pra fora; identidade "-" = ad-hoc.
  execSync(`codesign --force --deep --sign - --timestamp=none "${appPath}"`, { stdio: 'inherit' });

  // Confirma que a assinatura ficou válida (aparece no log do CI).
  try {
    execSync(`codesign --verify --deep --strict --verbose=2 "${appPath}"`, { stdio: 'inherit' });
    console.log('[afterPack] assinatura ad-hoc OK');
  } catch (e) {
    console.warn('[afterPack] verificação reclamou (segue):', e && e.message);
  }
};
