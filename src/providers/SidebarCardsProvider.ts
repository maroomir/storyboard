import * as vscode from "vscode"

import { resolveStoryboardWorkspaceRoot } from "../core/workspace"
import { parseCard } from "../files/card"
import { createWebviewBridge, type StoryboardRpcHandlers } from "../messaging/bridge"
import { createAiRpcHandlers } from "../services/ai/rpcHandlers"
import { type AiProviderRegistry } from "../services/ai/providerRegistry"
import type { CardType } from "../shared/card"
import type { StoryboardResponsePayload } from "../shared/messaging"
import { createWebviewHtml, getWebviewDistRoot } from "./webviewHtml"

const cardEditorViewType = "storyboard.card"

interface SidebarCardsProviderOptions {
  readonly viewType: string
  readonly cardType: CardType
  readonly title: string
  readonly cardGlob: string
}

interface SidebarCardSummary {
  readonly type: CardType
  readonly id: string
  readonly name: string
  readonly uri: string
  readonly description?: string
  readonly error?: string
}

interface SidebarCardsInitialData {
  readonly type: CardType
  readonly title: string
  readonly cards: readonly SidebarCardSummary[]
  readonly isStoryboardProject: boolean
}

export interface SidebarCardsProvidersDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
}

export class SidebarCardsProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined
  private readonly disposables: vscode.Disposable[] = []

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly dependencies: SidebarCardsProvidersDependencies,
    private readonly options: SidebarCardsProviderOptions
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [getWebviewDistRoot(this.extensionUri)]
    }

    void this.bootstrapWebview(webviewView)
  }

  private async bootstrapWebview(webviewView: vscode.WebviewView): Promise<void> {
    const initialData = await this.createInitialData()

    webviewView.webview.html = createWebviewHtml(webviewView.webview, {
      extensionUri: this.extensionUri,
      title: this.options.title,
      view: "cards-sidebar",
      initialData
    })

    const bridge = createWebviewBridge(webviewView.webview, this.createHandlers())
    this.disposables.push(bridge)

    const storyboardRoot = await resolveStoryboardWorkspaceRoot()
    if (storyboardRoot) {
      this.registerCardWatcher(storyboardRoot)
    }

    void this.refreshCards()
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose()
    }
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      ...createAiRpcHandlers(this.dependencies.aiProviderRegistry),
      "cards.list": async (): Promise<StoryboardResponsePayload<"cards.list">> => ({
        cards: await this.loadCardSummaries()
      }),
      "cards.open": async (payload): Promise<StoryboardResponsePayload<"cards.open">> => {
        await vscode.commands.executeCommand(
          "vscode.openWith",
          vscode.Uri.parse(payload.uri),
          cardEditorViewType
        )

        return {}
      }
    }
  }

  private registerCardWatcher(workspaceRoot: vscode.Uri): void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, this.options.cardGlob)
    )

    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => void this.refreshCards()),
      watcher.onDidChange(() => void this.refreshCards()),
      watcher.onDidDelete(() => void this.refreshCards())
    )
  }

  private async refreshCards(): Promise<void> {
    await this.webviewView?.webview.postMessage({
      type: "event",
      method: "cards.listChanged",
      payload: await this.createInitialData()
    })
  }

  private async createInitialData(): Promise<SidebarCardsInitialData> {
    const storyboardRoot = await resolveStoryboardWorkspaceRoot()

    return {
      type: this.options.cardType,
      title: this.options.title,
      cards: await this.loadCardSummaries(storyboardRoot),
      isStoryboardProject: storyboardRoot !== undefined
    }
  }

  private async loadCardSummaries(workspaceRoot?: vscode.Uri): Promise<SidebarCardSummary[]> {
    const root = workspaceRoot ?? (await resolveStoryboardWorkspaceRoot())

    if (!root) {
      return []
    }

    const cardUris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, this.options.cardGlob),
      undefined
    )
    const summaries = await Promise.all(cardUris.map((uri) => this.loadCardSummary(uri)))

    return summaries.sort((left, right) => left.name.localeCompare(right.name, "ko"))
  }

  private async loadCardSummary(uri: vscode.Uri): Promise<SidebarCardSummary> {
    try {
      const rawCard = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
      const card = parseCard(rawCard)

      if (card.type !== this.options.cardType) {
        return {
          type: this.options.cardType,
          id: uri.path,
          name: uri.path.split("/").at(-1) ?? uri.toString(),
          uri: uri.toString(),
          error: `Expected ${this.options.cardType} card, got ${card.type}.`
        }
      }

      return {
        type: card.type,
        id: card.id,
        name: card.name,
        uri: uri.toString(),
        description: card.description
      }
    } catch (error) {
      return {
        type: this.options.cardType,
        id: uri.path,
        name: uri.path.split("/").at(-1) ?? uri.toString(),
        uri: uri.toString(),
        error: error instanceof Error ? error.message : "카드를 읽을 수 없습니다."
      }
    }
  }
}

export function registerSidebarCardsProviders(
  context: vscode.ExtensionContext,
  dependencies: SidebarCardsProvidersDependencies
): vscode.Disposable {
  const charactersProvider = new SidebarCardsProvider(context.extensionUri, dependencies, {
    viewType: "storyboard.charactersView",
    cardType: "character",
    title: "Characters",
    cardGlob: "character/*.card"
  })
  const backgroundsProvider = new SidebarCardsProvider(context.extensionUri, dependencies, {
    viewType: "storyboard.backgroundsView",
    cardType: "background",
    title: "Backgrounds",
    cardGlob: "background/*.card"
  })

  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider("storyboard.charactersView", charactersProvider),
    vscode.window.registerWebviewViewProvider("storyboard.backgroundsView", backgroundsProvider),
    charactersProvider,
    backgroundsProvider
  )
}
