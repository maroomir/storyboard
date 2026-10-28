import * as vscode from 'vscode';

import { getStoryboardProjectPaths } from '@storyboard/story-model';
import { WorkspaceInitializer } from '@storyboard/story-engine';

import { registerAbsorbNotesCommand } from '@/presentation/commands/absorbNotes';
import { registerInitCommand } from '@/presentation/commands/init';
import { registerSetApiKeyCommand } from '@/presentation/commands/setApiKey';
import { registerStoryboardWorkspaceContext } from '@/infrastructure/vscode/storyboardWorkspaceContext';

import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from './platformModule';

export class ProjectModule implements IApplicationModule {
  private readonly disposables: DisposableStore = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    this.disposables.add(
      registerStoryboardWorkspaceContext(context),
      registerInitCommand({ logger: this.platform.logger }),
      registerAbsorbNotesCommand({
        logger: this.platform.logger,
        notes: this.platform.notes,
        runGate: this.platform.runGate,
      }),
      registerSetApiKeyCommand({ secretStore: this.platform.secretStore }),
    );

    void this.migrateOpenWorkspaces();
  }

  private async migrateOpenWorkspaces(): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        await new WorkspaceInitializer(this.platform.fileSystem).migrateLegacyMemory(
          getStoryboardProjectPaths(folder.uri),
        );
      } catch (error) {
        this.platform.logger.warn(`AI 기억 이관에 실패했습니다: ${String(error)}`);
      }
    }
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
