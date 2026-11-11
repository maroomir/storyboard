import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { StudioCreatableKind } from '@storyboard/story-model';
import { getTargetWorkspaceFolder } from '@/infrastructure/vscode/workspace';
import type { StudioLauncher } from '@/presentation/providers/studioLauncher';

export interface CreateCardCommandDependencies {
  readonly launcher: Pick<StudioLauncher, 'requestCreate'>;
}

export abstract class CreateCardCommandBase implements IExtensionCommand {
  public abstract readonly id: string;

  protected constructor(private readonly dependencies: CreateCardCommandDependencies) {}

  public abstract run(...args: never[]): unknown;

  protected async create(kind: StudioCreatableKind): Promise<void> {
    const workspaceFolder: vscode.WorkspaceFolder | undefined = await getTargetWorkspaceFolder();

    if (workspaceFolder) {
      await this.dependencies.launcher.requestCreate(kind);
    }
  }
}
