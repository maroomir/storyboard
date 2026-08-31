import * as vscode from 'vscode';

import type { IRelationGraphPanel } from '../../presentation/providers/RelationGraphProvider';

export function registerOpenRelationGraphCommand(
  context: vscode.ExtensionContext,
  relationGraphPanel: IRelationGraphPanel,
): vscode.Disposable {
  return vscode.commands.registerCommand('storyboard.relationGraph.open', () => {
    relationGraphPanel.reveal(context.extensionUri);
  });
}
