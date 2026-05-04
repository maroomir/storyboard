import * as vscode from "vscode"

import { createWebviewBridge, type StoryboardRpcHandlers } from "../messaging/bridge"
import { createAiRpcHandlers } from "../services/ai/rpcHandlers"
import { type AiProviderRegistry } from "../services/ai/providerRegistry"
import { aiProviderIds } from "../services/ai/types"
import { type SecretStore } from "../services/secrets/SecretStore"
import { type ConfigBridge } from "../services/settings/ConfigBridge"
import { createSettingsRpcHandlers, getSettingsReadSnapshot } from "../services/settings/settingsRpcHandlers"
import type { StoryboardResponsePayload } from "../shared/messaging"
import { createWebviewHtml, getWebviewDistRoot } from "./webviewHtml"

const panelViewType = "storyboard.settings"

export interface SettingsPanelDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly secretStore: SecretStore
  readonly configBridge: ConfigBridge
}

let settingsPanel: vscode.WebviewPanel | undefined
let settingsBridge: { readonly dispose: () => void } | undefined
let settingsHostSubscriptions: vscode.Disposable | undefined

export function revealSettingsPanel(extensionUri: vscode.Uri, dependencies: SettingsPanelDependencies): void {
  if (settingsPanel) {
    settingsPanel.reveal(vscode.ViewColumn.Active)
    void postSettingsChanged(dependencies)
    return
  }

  void openSettingsPanel(extensionUri, dependencies)
}

async function openSettingsPanel(extensionUri: vscode.Uri, dependencies: SettingsPanelDependencies): Promise<void> {
  const initialSnapshot = await getSettingsReadSnapshot({
    configBridge: dependencies.configBridge,
    registry: dependencies.aiProviderRegistry
  })

  const panel = vscode.window.createWebviewPanel(panelViewType, "Storyboard Settings", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [getWebviewDistRoot(extensionUri)]
  })

  settingsPanel = panel

  panel.webview.html = createWebviewHtml(panel.webview, {
    extensionUri,
    title: "Storyboard Settings",
    view: "settings",
    initialData: initialSnapshot
  })

  settingsBridge = createWebviewBridge(panel.webview, createSettingsPanelHandlers(dependencies))

  const secretDisposables = aiProviderIds.map((providerId) =>
    dependencies.secretStore.onDidChangeApiKey(providerId, () => {
      void postSettingsChanged(dependencies)
    })
  )

  settingsHostSubscriptions = vscode.Disposable.from(
    dependencies.configBridge.onDidChange(() => {
      void postSettingsChanged(dependencies)
    }),
    ...secretDisposables
  )

  panel.onDidDispose(() => {
    settingsBridge?.dispose()
    settingsBridge = undefined
    settingsHostSubscriptions?.dispose()
    settingsHostSubscriptions = undefined
    settingsPanel = undefined
  })
}

async function postSettingsChanged(dependencies: SettingsPanelDependencies): Promise<void> {
  if (!settingsPanel) {
    return
  }

  const payload: StoryboardResponsePayload<"settings.read"> = await getSettingsReadSnapshot({
    configBridge: dependencies.configBridge,
    registry: dependencies.aiProviderRegistry
  })

  await settingsPanel.webview.postMessage({
    type: "event",
    method: "settings.changed",
    payload
  })
}

function createSettingsPanelHandlers(dependencies: SettingsPanelDependencies): StoryboardRpcHandlers {
  return {
    ...createAiRpcHandlers(dependencies.aiProviderRegistry),
    ...createSettingsRpcHandlers({
      configBridge: dependencies.configBridge,
      secretStore: dependencies.secretStore,
      registry: dependencies.aiProviderRegistry
    })
  }
}
