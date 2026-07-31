import { existsSync } from 'node:fs';

import * as vscode from 'vscode';

import { resolveStorygramPaths } from '../../infrastructure/storygram/storygramConfigFile';
import { checkStorygramHealth } from '../../infrastructure/storygram/storygramHealth';
import { restartStorygramAgent } from '../../infrastructure/storygram/storygramAgent';
import { waitForStorygramOnline } from '../../infrastructure/storygram/storygramInstaller';

export function registerOpenBotConfigCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('storyboard.bot.openConfig', async (): Promise<void> => {
    const { configFile } = resolveStorygramPaths();

    if (!existsSync(configFile)) {
      const choice = await vscode.window.showWarningMessage(
        `봇 설정이 아직 없습니다 (${configFile}).`,
        '설정 마법사 실행',
      );
      if (choice === '설정 마법사 실행') {
        await vscode.commands.executeCommand('storyboard.bot.setup');
      }
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(configFile));
    await vscode.window.showTextDocument(document);
    // SECURITY: the file holds the bot token, so nothing here echoes its contents into a message.
    void vscode.window.showInformationMessage(
      '봇은 설정을 부팅 때만 읽습니다. 편집 후 `Storyboard: 텔레그램 봇 재시작`으로 반영하세요.',
    );
  });
}

const RESTART_POLL_ATTEMPTS = 10;
const RESTART_POLL_DELAY_MS = 1_000;

export function registerRestartBotCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('storyboard.bot.restart', async (): Promise<void> => {
    const result = await restartStorygramAgent();

    if (result.status === 'unsupported-platform') {
      await vscode.window.showInformationMessage(
        '자동 재시작은 macOS(launchd)에서만 지원됩니다. 봇 프로세스를 직접 재시작하세요.',
      );
      return;
    }
    if (result.status === 'not-installed') {
      await vscode.window.showWarningMessage(
        '로그인 시 자동 시작(launchd)이 설치되어 있지 않아 재시작할 수 없습니다. 봇을 직접 실행 중이라면 그 프로세스를 재시작하세요.',
      );
      return;
    }
    if (result.status === 'failed') {
      await vscode.window.showErrorMessage(`봇 재시작에 실패했습니다: ${result.detail}`);
      return;
    }

    const online = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '봇을 재시작하는 중…' },
      () =>
        waitForStorygramOnline({
          check: () => checkStorygramHealth(),
          isOnline: (health) => health.status === 'online',
          attempts: RESTART_POLL_ATTEMPTS,
          delayMs: RESTART_POLL_DELAY_MS,
        }),
    );

    if (online) {
      void vscode.window.showInformationMessage('봇을 재시작했습니다. 새 설정이 적용되었습니다.');
      return;
    }

    void vscode.window.showWarningMessage(
      '재시작했지만 봇이 응답하지 않습니다. 설정 오류일 수 있습니다 — 로그(~/Library/Logs/storygram/storygram.err.log)를 확인하세요.',
    );
  });
}
