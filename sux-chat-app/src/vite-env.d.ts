/// <reference types="vite/client" />

interface ElectronAPI {
  minimizeWindow: () => void;
  closeWindow: () => void;
  startDrag: () => void;
  saveFile: (fileUrl: string, fileName: string) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// Номер сборки, подставляется Vite на этапе сборки (см. vite.config.ts).
declare global {
  const __APP_BUILD__: string;
}
