import * as vscode from "vscode"

import { revealSettingsPanel, type SettingsPanelDependencies } from "../providers/SettingsPanelProvider"

export function registerOpenSettingsCommand(
  context: vscode.ExtensionContext,
  dependencies: SettingsPanelDependencies
): vscode.Disposable {
  return vscode.commands.registerCommand("storyboard.settings.open", () => {
    revealSettingsPanel(context.extensionUri, dependencies)
  })
}
