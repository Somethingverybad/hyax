import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "child_process";

// Номер сборки — число коммитов, то же, что versionCode у Android
// (см. android/app/build.gradle) и поле build в манифесте загрузок. Одна цифра
// на всех платформах, чтобы пользователь мог сверить приложение со страницей.
const appBuild = (() => {
  try {
    return execSync("git rev-list --count HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim() || "0";
  } catch {
    return "0";
  }
})();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 5143,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_BUILD__: JSON.stringify(appBuild),
  },
  // Добавляем настройки для Capacitor
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    // Важно для корректной работы роутинга в Capacitor
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  // Для корректного определения base path в Capacitor
  base: './',
}));