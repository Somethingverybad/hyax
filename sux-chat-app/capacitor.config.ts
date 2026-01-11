import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.huyaks.messenger',
  appName: 'ХУЯКС',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: [
      'sux.cardiokit.beget.tech',
      'localhost',
      '127.0.0.1'
    ]
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
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