
Сборка под ios: 
npm run build
npx cap sync ios
npx cap open ios

Сборка десктопа:
npm run dist:mac      # macOS: dmg + zip
npm run dist:win      # Windows: nsis
npm run dist:linux    # Linux: AppImage + deb + tar.gz

Про Linux подробно — ../LINUX_DESKTOP.md
