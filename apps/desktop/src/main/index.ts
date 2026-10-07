import { join } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

import { killRunningCliChildren } from '@storyboard/story-ai';
import { resolveStoryboardHomePaths } from '@storyboard/story-config';

import { ipcEventChannelName, ipcInvokeChannelName } from '@/shared/ipcChannelNames';

import { DesktopApp } from './desktopApp';
import { createInvokeHandlers } from './invokeHandlers';
import { createIpcRouter } from './ipcRouter';
import { createMainWindow, defaultMainWindowFiles } from './mainWindow';

let mainWindow: BrowserWindow | undefined;
let isQuitting = false;

// NOTE: the release workflow starts the packaged app with STORYBOARD_DESKTOP_SMOKE=1 and reads
// only the exit code: 0 once the renderer has mounted its first screen, 1 on a load failure, a
// renderer crash or the time limit. Nothing is written and no update check runs.
const isSmokeRun = process.env.STORYBOARD_DESKTOP_SMOKE === '1';
const smokeLimitMs = 30_000;

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
    confirm: async ({ title, detail, acceptLabel, declineLabel }) => {
      const options = {
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

function runSmoke(window: BrowserWindow): void {
  const finish = (code: number, message: string): void => {
    clearTimeout(deadline);
    (code === 0 ? console.log : console.error)(`smoke: ${message}`);
    isQuitting = true;
    app.exit(code);
  };
  const deadline = setTimeout(() => finish(1, `the renderer did not mount within ${smokeLimitMs} ms`), smokeLimitMs);

  window.webContents.on('did-fail-load', (_event, code, description) => finish(1, `load failed (${code} ${description})`));
  window.webContents.on('render-process-gone', (_event, details) => finish(1, `renderer gone (${details.reason})`));
  window.webContents.once('did-finish-load', () => {
    const poll = async (): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const isMounted = (await window.webContents.executeJavaScript(
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

  // NOTE: 창을 닫든 신호로 끝나든, 생성 중인 구독 CLI 자식은 앱과 함께 끝난다. 신호는 종료 확인을
  // 묻지 않는다 — 물어볼 사람이 없을 수 있다.
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
