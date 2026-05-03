import * as vscode from "vscode"

import { registerHelloWorldCommand } from "./commands/helloWorld"
import { registerInitCommand } from "./commands/init"
import { StoryboardLogger } from "./core/logger"
import { registerCardCustomEditorProvider } from "./providers/CardCustomEditorProvider"
import { registerSidebarCardsProviders } from "./providers/SidebarCardsProvider"

export function activate(context: vscode.ExtensionContext): void {
  const logger = new StoryboardLogger()
  logger.info("Activating Storyboard extension")

  context.subscriptions.push(logger)
  context.subscriptions.push(registerHelloWorldCommand())
  context.subscriptions.push(registerInitCommand({ logger }))
  context.subscriptions.push(registerCardCustomEditorProvider(context))
  context.subscriptions.push(registerSidebarCardsProviders(context))
}

export function deactivate(): void {}