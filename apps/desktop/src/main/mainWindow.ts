import { join } from 'node:path';

import { BrowserWindow, shell } from 'electron';

export interface MainWindowOptions {
  readonly preloadFile: string;
  readonly rendererFile: string;
  // Set by `npm run dev` so the page comes from the Vite server with hot reload.
  readonly devServerUrl?: string;
}

// SECURITY: the page runs sandboxed with context isolation and no Node. It may not navigate away or
// open windows; an https link opens in the system browser instead.
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Storyboard',
    backgroundColor: '#f5efe4',
    show: false,
    webPreferences: {
      preload: options.preloadFile,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (options.devServerUrl !== undefined) {
    void window.loadURL(options.devServerUrl);
  } else {
    void window.loadFile(options.rendererFile);
  }

  return window;
}

export function defaultMainWindowFiles(mainDirectory: string): Pick<MainWindowOptions, 'preloadFile' | 'rendererFile'> {
  return {
    preloadFile: join(mainDirectory, '..', 'preload', 'index.cjs'),
    rendererFile: join(mainDirectory, '..', 'renderer', 'index.html'),
  };
}
