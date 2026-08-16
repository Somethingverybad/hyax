import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.huyaks.messenger',
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
      // Не даём WebView менять размер самому: он делает это с задержкой и
      // анимацией, из-за чего поле ввода догоняло клавиатуру примерно через
      // секунду. Высоту считаем из visualViewport — он меняется сразу.
      resize: 'none' as any,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
  },
  ios: {
    scheme: 'ХУЯКС',
    scrollEnabled: true,
    // 🔧 ДОПОЛНИТЕЛЬНЫЕ НАСТРОЙКИ ДЛЯ ПОЛНОГО ЭКРАНА
  },
  // 🔧 НАСТРОЙКИ ДЛЯ ANDROID
  android: {
    overrideUserAgent: "true",
    appendUserAgent: "fullscreen-app",
    webContentsDebuggingEnabled: true
  }
};

export default config;