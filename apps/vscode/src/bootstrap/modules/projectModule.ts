import * as vscode from 'vscode';

import { getStoryboardProjectPaths, migrateLegacyMemory } from '@storyboard/story-engine';

import { registerInitCommand } from '@/presentation/commands/init';
import { registerSetApiKeyCommand } from '@/presentation/commands/setApiKey';
import { registerStoryboardWorkspaceContext } from '@/infrastructure/vscode/storyboardWorkspaceContext';

import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class ProjectModule implements IApplicationModule {
  private readonly disposables = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    this.disposables.add(
      registerStoryboardWorkspaceContext(context),
      registerInitCommand({ logger: this.platform.logger }),
      registerSetApiKeyCommand({ secretStore: this.platform.secretStore }),
    );

    void this.migrateOpenWorkspaces();
  }

  // NOTE: AI memory moved out of the gitignored cache directory; a workspace created before that
  // move is relocated on open. Failure only costs the workspace its carried-over memory, so it is
  // logged rather than allowed to fail activation.
  private async migrateOpenWorkspaces(): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        await migrateLegacyMemory(this.platform.fileSystem, getStoryboardProjectPaths(folder.uri));
      } catch (error) {
        this.platform.logger.warn(`AI 기억 이관에 실패했습니다: ${String(error)}`);
      }
    }
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
