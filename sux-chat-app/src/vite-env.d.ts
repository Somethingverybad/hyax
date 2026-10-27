/// <reference types="vite/client" />

interface ElectronAPI {
  minimizeWindow: () => void;
  closeWindow: () => void;
  startDrag: () => void;
  saveFile: (fileUrl: string, fileName: string) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
  /** Мини-плеер поверх окон (electron/playerWidget.cjs); нет в установщиках до 1.1.37. */
  playerState?: (s: Record<string, unknown>) => void;
  onPlayerCmd?: (cb: (cmd: string) => void) => () => void;
  setPlayerWidget?: (on: boolean) => void;
  playerWidgetEnabled?: () => Promise<boolean>;
  /** ⌘/Ctrl+Shift+Y — перевести буфер обмена (TranslatorHost); нет в установщиках до 1.1.38. */
  onTranslateClipboard?: (cb: (text: string) => void) => () => void;
  /** Демонстрация экрана (установщики с этой версии): источники для выбора. */
  /** opts.audio — можно показать со звуком компьютера (программа с 1.1.41). */
  onScreenPick?: (cb: (list: ScreenSource[], opts?: { audio?: boolean }) => void) => () => void;
  pickScreen?: (id: string | null, withAudio?: boolean) => void;
  /** Программа умеет показывать экран со звуком компьютера (с 1.1.41). */
  screenAudio?: boolean;
  /** macOS: granted | denied | not-determined | restricted; остальные — granted. */
  screenAccess?: () => Promise<string>;
  openScreenSettings?: () => void;
}

declare global {
  /** Экран или окно для демонстрации (electron/main.cjs → ScreenPicker). */
  interface ScreenSource {
    id: string;
    name: string;
    screen: boolean;
    thumb: string | null;
    icon: string | null;
  }
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// Модуль, а не скрипт: иначе declare global выше молча не действует.
export {};
