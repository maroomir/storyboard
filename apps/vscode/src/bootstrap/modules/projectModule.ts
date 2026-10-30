import * as vscode from 'vscode';

import { AbsorbNotesCommand } from '@/presentation/commands/absorbNotesCommand';
import { InitCommand } from '@/presentation/commands/initCommand';
import { SetApiKeyCommand } from '@/presentation/commands/setApiKeyCommand';
import { StoryboardWorkspaceContext } from '@/infrastructure/vscode/storyboardWorkspaceContext';

import { CommandRegistrar } from '@/bootstrap/commandRegistrar';
import { DisposableStore } from '@/bootstrap/lifecycle/disposableStore';
import type { IApplicationModule } from '@/bootstrap/lifecycle/applicationModule';
import type { IPlatformServices } from '@/bootstrap/modules/platformModule';

export class ProjectModule implements IApplicationModule {
  private readonly disposables: DisposableStore = new DisposableStore();

  public constructor(private readonly platform: IPlatformServices) {}

  public initialize(context: vscode.ExtensionContext): void {
    this.disposables.add(
      new StoryboardWorkspaceContext(context).register(),
      new CommandRegistrar().register([
        new InitCommand({ logger: this.platform.logger, workspace: this.platform.workspace }),
        new AbsorbNotesCommand({
          logger: this.platform.logger,
          notes: this.platform.notes,
          runGate: this.platform.runGate,
        }),
        new SetApiKeyCommand({ secretStore: this.platform.secretStore }),
      ]),
    );

    void this.migrateOpenWorkspaces();
  }

  private async migrateOpenWorkspaces(): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      try {
        await this.platform.workspace.migrateLegacyMemory(folder.uri);
      } catch (error) {
        this.platform.logger.warn(`AI 기억 이관에 실패했습니다: ${String(error)}`);
      }
    }
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
