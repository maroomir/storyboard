import * as vscode from "vscode"

import { loadRelationListCharacters } from "../core/relationGraphData"
import { resolveStoryboardWorkspaceRoot } from "../core/workspace"
import { createWebviewBridge, type StoryboardRpcHandlers } from "../messaging/bridge"
import { createAiRpcHandlers } from "../services/ai/rpcHandlers"
import { type AiProviderRegistry } from "../services/ai/providerRegistry"
import type { RelationListCharacter, StoryboardResponsePayload } from "../shared/messaging"
import { createWebviewHtml, getWebviewDistRoot } from "./webviewHtml"

const cardEditorViewType = "storyboard.card"
const panelViewType = "storyboard.relationGraph"

export interface RelationGraphPanelDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
}

interface RelationGraphInitialData {
  readonly title: string
  readonly characters: readonly RelationListCharacter[]
  readonly isStoryboardProject: boolean
}

let relationGraphPanel: vscode.WebviewPanel | undefined
let relationGraphBridge: { readonly dispose: () => void } | undefined
let relationGraphWatchers: vscode.Disposable | undefined

export function revealRelationGraphPanel(
  extensionUri: vscode.Uri,
  dependencies: RelationGraphPanelDependencies
): void {
  if (relationGraphPanel) {
    relationGraphPanel.reveal(vscode.ViewColumn.Active)
    void refreshRelationGraphWebview()
    return
  }

  void openRelationGraphPanel(extensionUri, dependencies)
}

async function openRelationGraphPanel(
  extensionUri: vscode.Uri,
  dependencies: RelationGraphPanelDependencies
): Promise<void> {
  const initialData = await createRelationGraphInitialData()

  const panel = vscode.window.createWebviewPanel(panelViewType, "Character Relations", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [getWebviewDistRoot(extensionUri)]
  })

  relationGraphPanel = panel

  panel.webview.html = createWebviewHtml(panel.webview, {
    extensionUri,
    title: "Character Relations",
    view: "relation-graph",
    initialData
  })

  relationGraphBridge = createWebviewBridge(panel.webview, createRelationGraphHandlers(dependencies))

  const storyboardRoot = await resolveStoryboardWorkspaceRoot()
  if (storyboardRoot) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(storyboardRoot, "character/*.card"))
    const scheduleRefresh = (): void => {
      void refreshRelationGraphWebview()
    }

    relationGraphWatchers = vscode.Disposable.from(
      watcher,
      watcher.onDidCreate(scheduleRefresh),
      watcher.onDidChange(scheduleRefresh),
      watcher.onDidDelete(scheduleRefresh)
    )
  }

  panel.onDidDispose(() => {
    relationGraphBridge?.dispose()
    relationGraphBridge = undefined
    relationGraphWatchers?.dispose()
    relationGraphWatchers = undefined
    relationGraphPanel = undefined
  })
}

async function refreshRelationGraphWebview(): Promise<void> {
  if (!relationGraphPanel) {
    return
  }

  await relationGraphPanel.webview.postMessage({
    type: "event",
    method: "relations.listChanged",
    payload: await createRelationGraphInitialData()
  })
}

async function createRelationGraphInitialData(): Promise<RelationGraphInitialData> {
  const storyboardRoot = await resolveStoryboardWorkspaceRoot()

  return {
    title: "Character Relations",
    characters: storyboardRoot ? await loadRelationListCharacters(storyboardRoot) : [],
    isStoryboardProject: storyboardRoot !== undefined
  }
}

function createRelationGraphHandlers(dependencies: RelationGraphPanelDependencies): StoryboardRpcHandlers {
  return {
    ...createAiRpcHandlers(dependencies.aiProviderRegistry),
    "relations.list": async (): Promise<StoryboardResponsePayload<"relations.list">> => ({
      characters: await loadRelationListCharactersForRpc()
    }),
    "cards.open": async (payload): Promise<StoryboardResponsePayload<"cards.open">> => {
      await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.parse(payload.uri), cardEditorViewType)
      return {}
    }
  }
}

async function loadRelationListCharactersForRpc(): Promise<RelationListCharacter[]> {
  const storyboardRoot = await resolveStoryboardWorkspaceRoot()

  if (!storyboardRoot) {
    return []
  }

  return loadRelationListCharacters(storyboardRoot)
}
