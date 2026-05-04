import * as vscode from "vscode"

import { revealRelationGraphPanel, type RelationGraphPanelDependencies } from "../providers/RelationGraphProvider"

export function registerOpenRelationGraphCommand(
  context: vscode.ExtensionContext,
  dependencies: RelationGraphPanelDependencies
): vscode.Disposable {
  return vscode.commands.registerCommand("storyboard.relationGraph.open", () => {
    revealRelationGraphPanel(context.extensionUri, dependencies)
  })
}
