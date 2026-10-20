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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// Модуль, а не скрипт: иначе declare global выше молча не действует.
export {};
