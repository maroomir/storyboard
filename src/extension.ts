import * as vscode from "vscode"

const helloWorldCommand = "storyboard.helloWorld"

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(helloWorldCommand, () => {
    void vscode.window.showInformationMessage("Hello from Storyboard!")
  })

  context.subscriptions.push(disposable)
}

export function deactivate(): void {}