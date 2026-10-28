import * as vscode from 'vscode';

import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import {
  runDiagnosticsCheckCommand,
  type IDocumentDiagnosticsRunner,
} from '@/presentation/providers/diagnosticsShared';

export class DiagnosticsCheckCommand implements IExtensionCommand {
  public constructor(
    public readonly id: string,
    private readonly runner: IDocumentDiagnosticsRunner,
  ) {}

  public run(uri?: vscode.Uri): Promise<void> {
    return runDiagnosticsCheckCommand(this.runner, uri);
  }
}
