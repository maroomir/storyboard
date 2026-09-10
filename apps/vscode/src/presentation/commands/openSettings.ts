import * as vscode from 'vscode';

import type { ISettingsPanel } from '@/presentation/providers/SettingsPanelProvider';

export const openSettingsCommand = 'storyboard.settings.open';

export function registerOpenSettingsCommand(
  context: vscode.ExtensionContext,
  settingsPanel: ISettingsPanel,
): vscode.Disposable {
  return vscode.commands.registerCommand(openSettingsCommand, () => {
    settingsPanel.reveal(context.extensionUri);
  });
}
