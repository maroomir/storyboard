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
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
