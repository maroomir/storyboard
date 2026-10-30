import { join } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

import { killRunningCliChildren } from '@storyboard/story-ai';
import { resolveStoryboardHomePaths } from '@storyboard/story-config';

import { ipcEventChannelName, ipcInvokeChannelName } from '@/shared/ipcChannelNames';

import { DesktopApp, type ConfirmQuestion } from '@/main/desktopApp';
import { createInvokeHandlers } from '@/main/invokeHandlers';
import { IpcRouter } from '@/main/ipcRouter';
import { createMainWindow, defaultMainWindowFiles } from '@/main/mainWindow';
import type { InvokeChannel, InvokeResult } from '@/shared/ipcContract';

let mainWindow: BrowserWindow | undefined;
let isQuitting: boolean = false;

const isSmokeRun: boolean = process.env.STORYBOARD_DESKTOP_SMOKE === '1';
const smokeLimitMs: number = 30_000;

function startDesktopApp(): DesktopApp {
  const desktop: DesktopApp = new DesktopApp({
    homePaths: resolveStoryboardHomePaths(process.env),
    logFile: join(app.getPath('logs'), 'desktop.log'),
    version: app.getVersion(),
    systemLocale: app.getLocale(),
    documentsDirectory: app.getPath('documents'),
    chooseDirectory: async (title: string, defaultPath?: string): Promise<string | undefined> => {
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
        ...(defaultPath === undefined ? {} : { defaultPath }),
      };
      const dialogChoice: Electron.OpenDialogReturnValue = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return dialogChoice.canceled ? undefined : dialogChoice.filePaths[0];
    },
    chooseFile: async (title: string, extensions: readonly string[]): Promise<string | undefined> => {
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ['openFile'] as 'openFile'[],
        filters: [{ name: extensions.join(', '), extensions: [...extensions] }],
      };
      const dialogChoice: Electron.OpenDialogReturnValue = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return dialogChoice.canceled ? undefined : dialogChoice.filePaths[0];
    },
    emit: (event, payload) => mainWindow?.webContents.send(ipcEventChannelName(event), payload),
    notify: (message: string): void => {
      void dialog.showMessageBox({ type: 'warning', message });
    },
    confirm: async ({ title, detail, acceptLabel, declineLabel }: ConfirmQuestion): Promise<boolean> => {
      const options: Electron.MessageBoxOptions = {
        type: 'warning' as const,
        message: title,
        detail,
        buttons: [declineLabel, acceptLabel],
        defaultId: 0,
        cancelId: 0,
      };
      const { response } = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);

      return response === 1;
    },
    installUpdate: (): void => {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    },
  });

  const route: (message: unknown) => Promise<InvokeResult<InvokeChannel>> = new IpcRouter(createInvokeHandlers(desktop), desktop.logger, {
    invalidRequest: () => desktop.translate('error.invalidRequest'),
    internal: (message) => desktop.translate('error.internal', { message }),
  }).route;

  ipcMain.handle(ipcInvokeChannelName, async (event, message: unknown) =>
    event.sender === mainWindow?.webContents ? await route(message) : undefined,
  );

  return desktop;
}

async function confirmClose(desktop: DesktopApp): Promise<'finish-scene' | 'now' | 'stay'> {
  if (!desktop.session?.runs.isBusy) {
    return 'now';
  }

  const options: Electron.MessageBoxOptions = {
    type: 'question' as const,
    message: desktop.translate('quit.runningTitle'),
    detail: desktop.translate('quit.runningDetail'),
    buttons: [desktop.translate('quit.pauseAndClose'), desktop.translate('quit.closeNow'), desktop.translate('common.cancel')],
    defaultId: 0,
    cancelId: 2,
  };
  const { response } = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);

  return response === 0 ? 'finish-scene' : response === 1 ? 'now' : 'stay';
}

function openMainWindow(desktop: DesktopApp): void {
  mainWindow = createMainWindow({
    ...defaultMainWindowFiles(__dirname),
    ...(process.env.STORYBOARD_DESKTOP_DEV_URL === undefined ? {} : { devServerUrl: process.env.STORYBOARD_DESKTOP_DEV_URL }),
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    void confirmClose(desktop).then(async (choice) => {
      if (choice === 'stay') {
        return;
      }

      await desktop.shutdown(choice);
      isQuitting = true;
      app.quit();
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

function runSmoke(window: BrowserWindow): void {
  const finish = (code: number, message: string): void => {
    clearTimeout(deadline);
    (code === 0 ? console.log : console.error)(`smoke: ${message}`);
    isQuitting = true;
    app.exit(code);
  };
  const deadline: NodeJS.Timeout = setTimeout(() => finish(1, `the renderer did not mount within ${smokeLimitMs} ms`), smokeLimitMs);

  window.webContents.on('did-fail-load', (_event, code, description) => finish(1, `load failed (${code} ${description})`));
  window.webContents.on('render-process-gone', (_event, details) => finish(1, `renderer gone (${details.reason})`));
  window.webContents.once('did-finish-load', () => {
    const poll = async (): Promise<void> => {
      for (let attempt: number = 0; attempt < 100; attempt += 1) {
        const isMounted: boolean = (await window.webContents.executeJavaScript(
          'document.getElementById("root")?.childElementCount > 0',
        )) as boolean;
        if (isMounted) {
          finish(0, 'renderer mounted');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      finish(1, 'the renderer loaded but mounted nothing');
    };
    void poll();
  });
}

function checkForUpdates(desktop: DesktopApp): void {
  if (!app.isPackaged) {
    return;
  }

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send(ipcEventChannelName('app.updateReady'), { version: info.version });
  });
  autoUpdater.on('error', (error) => desktop.logger.warn(`Update check failed: ${error.message}`));
  void autoUpdater.checkForUpdates().catch(() => undefined);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow?.focus();
  });

  void app.whenReady().then(() => {
    const desktop: DesktopApp = startDesktopApp();
    openMainWindow(desktop);
    if (isSmokeRun && mainWindow !== undefined) {
      runSmoke(mainWindow);
      return;
    }
    checkForUpdates(desktop);

    app.on('activate', () => {
      if (mainWindow === undefined) {
        openMainWindow(desktop);
      }
    });
  });

  app.on('window-all-closed', () => app.quit());

  app.on('will-quit', killRunningCliChildren);
  for (const [signal, exitCode] of [
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ] as const) {
    process.on(signal, () => {
      killRunningCliChildren();
      app.exit(exitCode);
    });
  }
}
