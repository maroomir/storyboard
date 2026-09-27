import { join } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

import { resolveStoryboardHomePaths } from '@storyboard/story-config';

import { ipcEventChannelName, ipcInvokeChannelName } from '@/shared/ipcChannelNames';

import { DesktopApp } from './desktopApp';
import { createInvokeHandlers } from './invokeHandlers';
import { createIpcRouter } from './ipcRouter';
import { createMainWindow, defaultMainWindowFiles } from './mainWindow';

let mainWindow: BrowserWindow | undefined;
let isQuitting = false;

function startDesktopApp(): DesktopApp {
  const desktop = new DesktopApp({
    homePaths: resolveStoryboardHomePaths(process.env),
    logFile: join(app.getPath('logs'), 'desktop.log'),
    version: app.getVersion(),
    systemLocale: app.getLocale(),
    documentsDirectory: app.getPath('documents'),
    chooseDirectory: async (title, defaultPath) => {
      const options = {
        title,
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
        ...(defaultPath === undefined ? {} : { defaultPath }),
      };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return result.canceled ? undefined : result.filePaths[0];
    },
    emit: (event, payload) => mainWindow?.webContents.send(ipcEventChannelName(event), payload),
    notify: (message) => {
      void dialog.showMessageBox({ type: 'warning', message });
    },
    installUpdate: () => {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    },
  });

  const route = createIpcRouter(createInvokeHandlers(desktop), desktop.logger, {
    invalidRequest: () => desktop.t('error.invalidRequest'),
    internal: (message) => desktop.t('error.internal', { message }),
  });

  // SECURITY: only our own window may call main. Another frame (there should be none) is refused.
  ipcMain.handle(ipcInvokeChannelName, async (event, message: unknown) =>
    event.sender === mainWindow?.webContents ? await route(message) : undefined,
  );

  return desktop;
}

// Closing mid-run asks whether to let the scene in progress finish. Either way the run resumes the
// next time the work opens; closing is never the reason a paid scene is thrown away unasked.
async function confirmClose(desktop: DesktopApp): Promise<'finish-scene' | 'now' | 'stay'> {
  if (!desktop.session?.runs.isBusy) {
    return 'now';
  }

  const options = {
    type: 'question' as const,
    message: desktop.t('quit.runningTitle'),
    detail: desktop.t('quit.runningDetail'),
    buttons: [desktop.t('quit.pauseAndClose'), desktop.t('quit.closeNow'), desktop.t('common.cancel')],
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

function checkForUpdates(desktop: DesktopApp): void {
  // An unpackaged build has no update feed; a failed check must never stop the app.
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
    const desktop = startDesktopApp();
    openMainWindow(desktop);
    checkForUpdates(desktop);

    app.on('activate', () => {
      if (mainWindow === undefined) {
        openMainWindow(desktop);
      }
    });
  });

  app.on('window-all-closed', () => app.quit());
}
