import * as vscode from 'vscode';

import {
  checkStorygramHealth,
  type StorygramHealth,
} from '../../infrastructure/storygram/storygramHealth';

const POLL_INTERVAL_MS = 15_000;

export class BotStatusBarItem implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly timer: ReturnType<typeof setInterval>;

  public constructor() {
    this.item = vscode.window.createStatusBarItem(
      'storyboard.bot',
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = 'storygram';
    this.item.text = '$(comment-discussion) storygram';
    this.item.show();

    this.timer = setInterval((): void => {
      void this.refresh();
    }, POLL_INTERVAL_MS);
    void this.refresh();
  }

  public dispose(): void {
    clearInterval(this.timer);
    this.item.dispose();
  }

  private async refresh(): Promise<void> {
    this.render(await checkStorygramHealth());
  }

  private render(health: StorygramHealth): void {
    switch (health.status) {
      case 'unconfigured':
        this.item.text = '$(comment-discussion) storygram 미설정';
        this.item.tooltip = '텔레그램 봇 설정이 없습니다. 클릭해 설정 마법사를 시작하세요.';
        this.item.command = 'storyboard.bot.setup';
        return;
      case 'dashboard-disabled':
        this.item.text = '$(comment-discussion) storygram ◌';
        this.item.tooltip =
          '봇 대시보드가 꺼져 있어 상태를 관찰할 수 없습니다 (dashboard.enabled=false).';
        this.item.command = undefined;
        return;
      case 'offline':
        this.item.text = '$(comment-discussion) storygram ○';
        this.item.tooltip = `봇이 응답하지 않습니다 (127.0.0.1:${health.port}).`;
        this.item.command = 'storyboard.bot.openDashboard';
        return;
      case 'online':
        this.item.text = '$(comment-discussion) storygram ●';
        this.item.tooltip = `봇 실행 중 — ${health.projectName} (동기화: ${health.syncState}). 클릭해 대시보드를 엽니다.`;
        this.item.command = 'storyboard.bot.openDashboard';
        return;
    }
  }
}
