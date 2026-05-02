import * as vscode from "vscode"

const helloWorldCommand = "storyboard.helloWorld"

export function registerHelloWorldCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(helloWorldCommand, () => {
    void vscode.window.showInformationMessage("Hello from Storyboard!")
  })
}