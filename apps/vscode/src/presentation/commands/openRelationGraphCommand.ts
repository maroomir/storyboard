import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { IRelationGraphPanel } from '@/presentation/providers/RelationGraphProvider';

export class OpenRelationGraphCommand implements IExtensionCommand {
  public readonly id: string = 'storyboard.relationGraph.open';

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly relationGraphPanel: IRelationGraphPanel,
  ) {}

  public run(): void {
    this.relationGraphPanel.reveal(this.context.extensionUri);
  }
}
