import * as vscode from 'vscode';

import {
  readStorygramDashboardTarget,
  resolveStorygramPaths,
} from '../../infrastructure/storygram/storygramConfigFile';

export function registerOpenBotDashboardCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'storyboard.bot.openDashboard',
    async (): Promise<void> => {
      const { configFile } = resolveStorygramPaths();
      const target = await readStorygramDashboardTarget(configFile);

      if (target === undefined) {
        await vscode.window.showWarningMessage(
          `storygram 설정이 없습니다 (${configFile}). apps/bot/README.md를 참고해 봇을 설정하세요.`,
        );
        return;
      }
      if (!target.enabled) {
        await vscode.window.showWarningMessage(
          'storygram 대시보드가 꺼져 있습니다 (dashboard.enabled=false).',
        );
        return;
      }

      await vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${target.port}/`));
    },
  );
}
