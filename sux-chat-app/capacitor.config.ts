import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hyax.messenger',
  appName: 'ХУЯКС',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: [
      'huyax.e-tree.su',
      'localhost',
      '127.0.0.1'
    ]
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    },
    Keyboard: {
      // Штатный режим: WebView сжимается под клавиатуру сам. Пробовал 'none' с
      // ручным расчётом высоты — тогда страница остаётся полноразмерной, и
      // панель ввода уходит под клавиатуру. Задержку, из-за которой поле
      // догоняло клавиатуру, снимает синхронизация высоты по visualViewport
      // (см. main.tsx), а не отключение ресайза.
      // WebView не перекомпоновывается: иначе iOS сжимает его уже посреди
      // анимации клавиатуры, и панель ввода дёргается. Вместо этого двигаем
      // её сами — плагин сообщает высоту и длительность до начала анимации
      // (см. main.tsx), поэтому движение получается синхронным.
      resize: 'none' as any,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
  },
  ios: {
    // Весь скролл — во внутренних контейнерах страницы. Нативный скролл
    // WebView при resize:'none' только вредит: iOS сама прокручивает WebView
    // к сфокусированному полю (мы и так двигаем панель transform-ом) и после
    // пикера файлов или клавиатуры не возвращает смещение — весь интерфейс
    // остаётся съехавшим, панель ввода уходит за нижний край.
    scrollEnabled: false,
  },
  // 🔧 НАСТРОЙКИ ДЛЯ ANDROID
  android: {
    overrideUserAgent: "true",
    appendUserAgent: "fullscreen-app",
    webContentsDebuggingEnabled: true
  }
};

export default config;