import * as vscode from "vscode"

import { registerHelloWorldCommand } from "./commands/helloWorld"
import { registerInitCommand } from "./commands/init"
import { StoryboardLogger } from "./core/logger"

export function activate(context: vscode.ExtensionContext): void {
  const logger = new StoryboardLogger()

  context.subscriptions.push(logger)
  context.subscriptions.push(registerHelloWorldCommand())
  context.subscriptions.push(registerInitCommand({ logger }))
}

export function deactivate(): void {}