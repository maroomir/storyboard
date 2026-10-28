import * as vscode from 'vscode';

import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';

export class CommandRegistrar {
  public register(commands: readonly IExtensionCommand[]): vscode.Disposable {
    return vscode.Disposable.from(
      ...commands.map((command) =>
        vscode.commands.registerCommand(command.id, (...args: never[]) => command.run(...args)),
      ),
    );
  }
}
