import * as vscode from 'vscode';

import type { StudioCreatableKind } from '@storyboard/story-model';
import { sidebarViewIds } from '@/contributionIds';

export class StudioLauncher implements vscode.Disposable {
  private readonly createRequests: vscode.EventEmitter<StudioCreatableKind> =
    new vscode.EventEmitter<StudioCreatableKind>();
  private pendingKind: StudioCreatableKind | undefined;

  public readonly onDidRequestCreate: vscode.Event<StudioCreatableKind> = this.createRequests.event;

  public async requestCreate(kind: StudioCreatableKind): Promise<void> {
    this.pendingKind = kind;
    await vscode.commands.executeCommand(`${sidebarViewIds.studio}.focus`);
    this.createRequests.fire(kind);
  }

  public takePendingKind(): StudioCreatableKind | undefined {
    const kind: StudioCreatableKind | undefined = this.pendingKind;
    this.pendingKind = undefined;
    return kind;
  }

  public dispose(): void {
    this.createRequests.dispose();
  }
}
