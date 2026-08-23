// electron-builder: хук после упаковки, до сборки DMG.
//
// Без подписи вообще приложение не запустится: упаковка меняет бандл
// Electron (имя, иконка, Info.plist), заводская печать ломается, и macOS на
// Apple Silicon считает такой бандл повреждённым — показывает «malware» и
// уносит в корзину. Ad-hoc-подпись (identity «-») восстанавливает целостность:
// локально собранное приложение запускается обычным двойным кликом.
// Для раздачи другим людям нужна подпись Developer ID + нотаризация — см.
// README в electron/ (когда появится сертификат, укажи его в build.mac.identity).
const { execSync } = require('child_process');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${appName}`);
};
