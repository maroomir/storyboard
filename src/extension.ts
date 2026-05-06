import * as vscode from "vscode"

import { registerApplyDraftFormatCommand } from "./commands/applyDraftFormat"
import { registerCreateCardCommands } from "./commands/createCard"
import { registerGenerateAllDraftsCommand } from "./commands/generateAllDrafts"
import { registerGenerateDraftCommands } from "./commands/generateDraft"
import { registerHelloWorldCommand } from "./commands/helloWorld"
import { registerInitCommand } from "./commands/init"
import { registerNewSceneCommands } from "./commands/newScene"
import { registerExpandDraftCommand } from "./commands/expandDraft"
import { registerOpenRelationGraphCommand } from "./commands/openRelationGraph"
import { registerOpenSettingsCommand } from "./commands/openSettings"
import { registerSetApiKeyCommand } from "./commands/setApiKey"
import { StoryboardLogger } from "./core/logger"
import { registerCardCustomEditorProvider } from "./providers/CardCustomEditorProvider"
import { registerDraftCodeLensProvider } from "./providers/DraftCodeLensProvider"
import { registerGrammarDiagnosticsProvider } from "./providers/GrammarDiagnosticsProvider"
import { registerInlineCompletionProvider } from "./providers/InlineCompletionProvider"
import { registerSceneCodeLensProvider } from "./providers/SceneCodeLensProvider"
import { registerSidebarCardsProviders } from "./providers/SidebarCardsProvider"
import { registerSidebarScenesProvider } from "./providers/SidebarScenesProvider"
import { createAiProviderRegistry } from "./services/ai/providerRegistry"
import { createVscodeUsageLedgerFileSystem, UsageRecorder } from "./services/ai/UsageRecorder"
import { SecretStore } from "./services/secrets/SecretStore"
import { ConfigBridge } from "./services/settings/ConfigBridge"

export function activate(context: vscode.ExtensionContext): void {
  const logger = new StoryboardLogger()
  const secretStore = new SecretStore(context.secrets)
  const configBridge = new ConfigBridge({
    getConfiguration: (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration("storyboard"),
    onDidChangeConfiguration: (listener): vscode.Disposable => vscode.workspace.onDidChangeConfiguration(listener)
  })
  const aiProviderRegistry = createAiProviderRegistry({ secretStore, configBridge })
  const usageRecorder = new UsageRecorder(createVscodeUsageLedgerFileSystem(), (message) =>
    logger.warn(message)
  )

  logger.info("Activating Storyboard extension")

  context.subscriptions.push(logger)
  context.subscriptions.push(configBridge.onDidChange(() => logger.info("Storyboard configuration changed")))
  context.subscriptions.push(registerHelloWorldCommand())
  context.subscriptions.push(registerCreateCardCommands())
  context.subscriptions.push(registerInitCommand({ logger }))
  context.subscriptions.push(registerSetApiKeyCommand({ secretStore }))
  context.subscriptions.push(usageRecorder)
  context.subscriptions.push(
    registerGenerateDraftCommands({ aiProviderRegistry, logger, usageRecorder })
  )
  context.subscriptions.push(
    registerGenerateAllDraftsCommand({ aiProviderRegistry, logger, usageRecorder })
  )
  context.subscriptions.push(
    registerApplyDraftFormatCommand({ aiProviderRegistry, logger, usageRecorder })
  )
  context.subscriptions.push(registerSceneCodeLensProvider())
  context.subscriptions.push(registerDraftCodeLensProvider())
  context.subscriptions.push(
    registerExpandDraftCommand({ aiProviderRegistry, logger, usageRecorder })
  )
  context.subscriptions.push(
    registerInlineCompletionProvider({ aiProviderRegistry, logger, usageRecorder })
  )
  context.subscriptions.push(
    registerGrammarDiagnosticsProvider({ aiProviderRegistry, logger, usageRecorder })
  )
  context.subscriptions.push(registerCardCustomEditorProvider(context))
  context.subscriptions.push(
    registerSidebarCardsProviders(context, { aiProviderRegistry, usageRecorder })
  )
  context.subscriptions.push(registerSidebarScenesProvider(context, { aiProviderRegistry, usageRecorder }))
  context.subscriptions.push(registerNewSceneCommands())
  context.subscriptions.push(registerOpenRelationGraphCommand(context, { aiProviderRegistry }))
  context.subscriptions.push(
    registerOpenSettingsCommand(context, { aiProviderRegistry, secretStore, configBridge })
  )
}

export function deactivate(): void {}