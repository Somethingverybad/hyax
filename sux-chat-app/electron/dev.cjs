// Запуск Electron в деве. Отдельный файл, потому что окружение приходится
// чинить в двух местах, и в npm-скрипт это не влезает кроссплатформенно.
//
// 1. Расширения VS Code выставляют ELECTRON_RUN_AS_NODE=1. С ним бинарник
//    Electron стартует как обычный Node, require('electron') отдаёт строку с
//    путём, и main.cjs падает на app.isPackaged — из терминала редактора
//    «npm run dev» просто не работал.
// 2. На Linux с Ubuntu 24.04+ песочница Chromium требует профиля AppArmor
//    (см. LINUX_DESKTOP.md). Для дева это лишняя возня: окно и так грузит
//    localhost со своим же кодом, поэтому там песочницу выключаем. Пакетов
//    для раздачи это не касается — они собираются с включённой.
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = [path.join(__dirname, '..')];
if (process.platform === 'linux') args.push('--no-sandbox');

const child = spawn(electron, args, { env, stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 0));
