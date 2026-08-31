import * as vscode from 'vscode';

import type { StoryboardLogger } from '@storyboard/story-engine';

export class OutputChannelLogger implements StoryboardLogger, vscode.Disposable {
  private readonly outputChannel = vscode.window.createOutputChannel('Storyboard');

  info(message: string): void {
    this.outputChannel.appendLine(`[info] ${message}`);
  }

  warn(message: string): void {
    this.outputChannel.appendLine(`[warn] ${message}`);
  }

  error(message: string, error?: unknown): void {
    this.outputChannel.appendLine(`[error] ${message}`);

    if (error instanceof Error) {
      this.outputChannel.appendLine(error.stack ?? error.message);
      return;
    }

    if (error !== undefined) {
      this.outputChannel.appendLine(String(error));
    }
  }

  show(): void {
    this.outputChannel.show(true);
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}
