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
