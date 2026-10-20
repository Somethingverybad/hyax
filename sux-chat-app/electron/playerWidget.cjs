// Мини-плеер для компьютера: маленькое окно поверх всех окон с названием
// трека и кнопками «предыдущий», «играть/пауза», «следующий», «стоп».
// Включается галочкой «Мини-плеер» в меню трея (и кнопкой у плеера в
// приложении), видно, пока что-то играет, «Стоп» его прячет. Окно можно
// таскать — место запоминаем (settings.json, playerWidget.pos).
//
// Музыка играет в главном окне (src/lib/player.ts): оно шлёт сюда состояние
// (player-state, src/lib/desktopPlayer.ts), мы рассылаем его мини-плееру,
// меню Dock (macOS) и кнопкам в превью на панели задач (Windows), а нажатия
// отправляем обратно командой player-cmd.
const { BrowserWindow, Menu, app, ipcMain, nativeImage, screen } = require('electron');

const W = 360, H = 74;
let deps = null;
let win = null;
let state = { hasTrack: false, title: '', artist: '', playing: false, live: false, time: 0, duration: 0 };
let shownKey = '';

const enabled = () => !!deps.readSettings().playerWidget;
const main = () => deps.getMain();

function cmd(c) {
  if (c === 'open') { deps.focusMain(); return; }
  if (c === 'close') { setEnabled(false); return; }
  const w = main();
  if (w && !w.isDestroyed()) w.webContents.send('player-cmd', c);
}

function setEnabled(on) {
  deps.writeSettings({ playerWidget: !!on });
  sync();
  deps.onMenuChange();
}

// ── Окно ───────────────────────────────────────────────────────────────────

function position() {
  const saved = deps.readSettings().playerWidgetPos;
  if (saved && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x >= a.x - W + 40 && saved.x <= a.x + a.width - 40 && saved.y >= a.y && saved.y <= a.y + a.height - 30;
  })) return saved;
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - W - 16, y: a.y + 16 };
}

function html() {
  const t = deps.tr;
  const label = (s) => JSON.stringify(t(s));
  // Текст трека вставляем только через textContent — никакой разметки из данных.
  return `<!doctype html><html lang="${deps.getLang()}"><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-user-select:none;user-select:none}
    .card{box-sizing:border-box;width:${W}px;height:${H}px;padding:10px 12px 12px;display:flex;gap:10px;align-items:center;border-radius:16px;position:relative;overflow:hidden;
      background:#1C2420;color:#fff;border:1px solid #37453D;box-shadow:0 8px 24px rgba(0,0,0,.35);-webkit-app-region:drag;animation:in .2s ease-out}
    @keyframes in{from{transform:translateY(-8px);opacity:0}to{transform:none;opacity:1}}
    button{-webkit-app-region:no-drag;border:0;background:transparent;color:#DCE5DF;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;border-radius:50%}
    button:hover{background:rgba(255,255,255,.08)}button:active{transform:scale(.92)}button:disabled{opacity:.3;cursor:default;background:transparent}
    .s{width:30px;height:30px;flex:none}.p{width:38px;height:38px;flex:none;background:#C7F964;color:#1C2420}.p:hover{background:#d6ff85}
    svg{width:16px;height:16px;fill:currentColor}.p svg{width:18px;height:18px}
    .t{min-width:0;flex:1;-webkit-app-region:no-drag;cursor:pointer}
    .n{font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .a{font-size:12px;color:#9AA59E;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .x{width:22px;height:22px;flex:none;color:#7F8B84;align-self:flex-start}.x svg{width:12px;height:12px}
    .bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.08)}.bar i{display:block;height:100%;width:0;background:#C7F964;transition:width .9s linear}
  </style></head><body>
  <div class="card">
    <button class="s" id="prev" title=${label('Предыдущий')}><svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg></button>
    <button class="p" id="toggle" title=${label('Играть')}><svg id="ic" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
    <button class="s" id="next" title=${label('Следующий')}><svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg></button>
    <button class="s" id="stop" title=${label('Стоп')}><svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg></button>
    <div class="t" id="open" title=${label('Открыть WYX')}><div class="n" id="title"></div><div class="a" id="artist"></div></div>
    <button class="x" id="close" title=${label('Закрыть мини-плеер')}><svg viewBox="0 0 24 24"><path d="M5 6.4 6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12z"/></svg></button>
    <div class="bar"><i id="bar"></i></div>
  </div>
  <script>
    const {ipcRenderer}=require('electron');
    const $=(id)=>document.getElementById(id);
    const PLAY='M8 5v14l11-7z', PAUSE='M7 5h4v14H7zM13 5h4v14h-4z';
    const L={play:${label('Играть')},pause:${label('Пауза')}};
    for (const id of ['prev','toggle','next','stop','open','close']) $(id).onclick=()=>ipcRenderer.send('player-widget-cmd', id);
    ipcRenderer.on('state',(_e,s)=>{
      $('title').textContent=s.title||'';
      $('artist').textContent=s.artist||'';
      $('ic').innerHTML='<path d="'+(s.playing?PAUSE:PLAY)+'"/>';
      $('toggle').title=s.playing?L.pause:L.play;
      $('prev').disabled=!!s.live; $('next').disabled=!!s.live;
      $('bar').style.width=(s.duration>0?Math.min(100,100*s.time/s.duration):0)+'%';
    });
  </script></body></html>`;
}

function open() {
  if (win && !win.isDestroyed()) return win;
  const { x, y } = position();
  win = new BrowserWindow({
    x, y, width: W, height: H, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('moved', () => { if (win && !win.isDestroyed()) { const [px, py] = win.getPosition(); deps.writeSettings({ playerWidgetPos: { x: px, y: py } }); } });
  win.on('closed', () => { win = null; shownKey = ''; });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html()));
  win.webContents.once('did-finish-load', () => { if (win && !win.isDestroyed()) { win.webContents.send('state', state); win.showInactive(); } });
  return win;
}

/** Показать или спрятать по галочке и по тому, играет ли что-то. */
function sync() {
  const want = enabled() && state.hasTrack;
  if (want) {
    const w = open();
    if (w.webContents.isLoading()) return;
    w.webContents.send('state', state);
    if (!w.isVisible()) w.showInactive();
  } else if (win && !win.isDestroyed()) {
    win.close();
  }
}

// ── Dock (macOS) и панель задач (Windows) ────────────────────────────────────

/** Значок 20×20 для кнопок превью Windows: белая фигура со сглаживанием. */
function icon(kind) {
  const N = 20, S = 4;
  const buf = Buffer.alloc(N * N * 4);
  const inTri = (px, py, ax, ay, bx, by, cx, cy) => {
    const d = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
    const d1 = d(px, py, ax, ay, bx, by), d2 = d(px, py, bx, by, cx, cy), d3 = d(px, py, cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const inRect = (px, py, x0, y0, x1, y1) => px >= x0 && px <= x1 && py >= y0 && py <= y1;
  const shapes = {
    play: (x, y) => inTri(x, y, 6, 4, 6, 16, 16, 10),
    pause: (x, y) => inRect(x, y, 5, 4, 8.5, 16) || inRect(x, y, 11.5, 4, 15, 16),
    next: (x, y) => inTri(x, y, 4, 4, 4, 16, 13, 10) || inRect(x, y, 13.5, 4, 16, 16),
    prev: (x, y) => inTri(x, y, 16, 4, 16, 16, 7, 10) || inRect(x, y, 4, 4, 6.5, 16),
    stop: (x, y) => inRect(x, y, 5, 5, 15, 15),
  }[kind];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let hit = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) if (shapes(x + (sx + 0.5) / S, y + (sy + 0.5) / S)) hit++;
    const a = Math.round(255 * hit / (S * S)), i = (y * N + x) * 4;
    buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = a; // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: N, height: N });
}
const icons = {};
const iconOf = (k) => (icons[k] ||= icon(k));

function updateThumbar() {
  if (process.platform !== 'win32') return;
  const w = main();
  if (!w || w.isDestroyed()) return;
  if (!state.hasTrack) { w.setThumbarButtons([]); return; }
  const t = deps.tr;
  w.setThumbarButtons([
    { tooltip: t('Предыдущий'), icon: iconOf('prev'), click: () => cmd('prev'), flags: state.live ? ['disabled'] : [] },
    { tooltip: state.playing ? t('Пауза') : t('Играть'), icon: iconOf(state.playing ? 'pause' : 'play'), click: () => cmd('toggle') },
    { tooltip: t('Следующий'), icon: iconOf('next'), click: () => cmd('next'), flags: state.live ? ['disabled'] : [] },
    { tooltip: t('Стоп'), icon: iconOf('stop'), click: () => cmd('stop') },
  ]);
}

function updateDock() {
  if (process.platform !== 'darwin' || !app.dock) return;
  const t = deps.tr;
  const items = [];
  if (state.hasTrack) {
    items.push({ label: [state.title, state.artist].filter(Boolean).join(' — ').slice(0, 60) || 'WYX', enabled: false });
    items.push({ label: state.playing ? t('Пауза') : t('Играть'), click: () => cmd('toggle') });
    if (!state.live) {
      items.push({ label: t('Следующий'), click: () => cmd('next') });
      items.push({ label: t('Предыдущий'), click: () => cmd('prev') });
    }
    items.push({ label: t('Стоп'), click: () => cmd('stop') });
    items.push({ type: 'separator' });
  }
  items.push(menuItem());
  app.dock.setMenu(Menu.buildFromTemplate(items));
}

/** Галочка «Мини-плеер» — для меню трея и Dock. */
function menuItem() {
  if (!deps) return { label: 'Мини-плеер', type: 'checkbox', checked: false, enabled: false };
  return { label: deps.tr('Мини-плеер'), type: 'checkbox', checked: enabled(), click: (item) => setEnabled(item.checked) };
}

function update(s) {
  const prev = state;
  state = { ...state, ...(s || {}) };
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('state', state);
  // Меню и кнопки — только когда поменялось что-то кроме времени.
  const key = [state.hasTrack, state.title, state.artist, state.playing, state.live].join('|');
  if (key !== shownKey) {
    shownKey = key;
    updateThumbar();
    updateDock();
  }
  if (prev.hasTrack !== state.hasTrack || !win) sync();
}

function init(d) {
  deps = d;
  ipcMain.on('player-state', (_e, s) => update(s));
  ipcMain.on('player-widget', (_e, on) => setEnabled(on));
  ipcMain.handle('player-widget-enabled', () => enabled());
  ipcMain.on('player-widget-cmd', (_e, c) => cmd(c));
  updateDock();
}

/** Сменили язык — перерисовать подписи. */
function relabel() {
  if (!deps) return;
  shownKey = '';
  updateThumbar();
  updateDock();
  if (win && !win.isDestroyed()) { win.destroy(); win = null; sync(); }
}

module.exports = { init, menuItem, relabel };
