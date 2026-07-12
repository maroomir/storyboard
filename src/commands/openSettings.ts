import * as vscode from "vscode"

import type { ISettingsPanel } from "../providers/SettingsPanelProvider"

export function registerOpenSettingsCommand(
  context: vscode.ExtensionContext,
  settingsPanel: ISettingsPanel
): vscode.Disposable {
  return vscode.commands.registerCommand("storyboard.settings.open", () => {
    settingsPanel.reveal(context.extensionUri)
  })
}
