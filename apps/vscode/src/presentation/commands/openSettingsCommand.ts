import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { ISettingsPanel } from '@/presentation/providers/SettingsPanelProvider';

export class OpenSettingsCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.settingsOpen;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly settingsPanel: ISettingsPanel,
  ) {}

  public run(): void {
    this.settingsPanel.reveal(this.context.extensionUri);
  }
}
