import * as vscode from 'vscode';

import { registerInitCommand } from '@/presentation/commands/init';
import { registerSetApiKeyCommand } from '@/presentation/commands/setApiKey';
import { registerStoryboardWorkspaceContext } from '@/infrastructure/vscode/storyboardWorkspaceContext';

import { DisposableStore } from '../lifecycle/disposableStore';
import type { IApplicationModule } from '../lifecycle/applicationModule';
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
  }

  public dispose(): void {
    this.disposables.dispose();
  }
}
