import * as vscode from "vscode"

import { draftPath, getStoryboardProjectPaths } from "../core/pathConventions"
import { resolveStoryboardWorkspaceRoot } from "../core/workspace"
import { emptyUsageSummary } from "../files/usageLedger"
import { readSceneFile, type SceneFileSystem } from "../files/scene"
import { createWebviewBridge, type StoryboardRpcHandlers } from "../messaging/bridge"
import { createAiRpcHandlers, createUsageRpcHandlers } from "../services/ai/rpcHandlers"
import { type AiProviderRegistry } from "../services/ai/providerRegistry"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import type { UsageSummaryByEntity } from "../services/ai/types"
import type { StoryboardResponsePayload } from "../shared/messaging"
import { parseSceneFileName } from "../shared/scene"
import { createWebviewHtml, getWebviewDistRoot } from "./webviewHtml"

const generateDraftCommand = "storyboard.draft.generate"
const scenesSidebarViewId = "storyboard.scenesView"

const vscodeFs: SceneFileSystem = {
  readFile: (uri: unknown) => vscode.workspace.fs.readFile(uri as vscode.Uri)
}

interface SidebarScenesInitialData {
  readonly title: string
  readonly scenes: readonly SceneListItem[]
  readonly isStoryboardProject: boolean
  readonly usage: UsageSummaryByEntity
}

export interface SceneListItem {
  readonly stem: string
  readonly order: number
  readonly slug: string
  readonly title?: string
  readonly sceneUri: string
  readonly draftUri?: string
  readonly status: "ready" | "stale" | "missing"
  readonly sceneMtime: number
  readonly draftMtime?: number
}

export interface SidebarScenesProviderDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly usageRecorder: UsageRecorder
}

export class SidebarScenesProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private webviewView: vscode.WebviewView | undefined
  private readonly disposables: vscode.Disposable[] = []

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly dependencies: SidebarScenesProviderDependencies
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
      title: "Scenes",
      view: "scenes-sidebar",
      initialData
    })

    const bridge = createWebviewBridge(webviewView.webview, this.createHandlers())
    this.disposables.push(bridge)

    this.disposables.push(
      this.dependencies.usageRecorder.onChange(() => {
        void this.postUsageChanged()
      })
    )

    const storyboardRoot = await resolveStoryboardWorkspaceRoot()
    if (storyboardRoot) {
      this.registerWatchers(storyboardRoot)
    }

    void this.refreshScenes()
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose()
    }
  }

  private createHandlers(): StoryboardRpcHandlers {
    return {
      ...createAiRpcHandlers(this.dependencies.aiProviderRegistry),
      ...createUsageRpcHandlers(this.dependencies.usageRecorder),
      "scenes.list": async (): Promise<StoryboardResponsePayload<"scenes.list">> => ({
        scenes: await this.loadSceneList()
      }),
      "scenes.openScene": async (payload): Promise<StoryboardResponsePayload<"scenes.openScene">> => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(payload.uri))
        await vscode.window.showTextDocument(document)
        return {}
      },
      "scenes.openDraft": async (payload): Promise<StoryboardResponsePayload<"scenes.openDraft">> => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(payload.uri))
        await vscode.window.showTextDocument(document)
        return {}
      },
      "scenes.generateDraft": async (payload): Promise<StoryboardResponsePayload<"scenes.generateDraft">> => {
        await vscode.commands.executeCommand(generateDraftCommand, vscode.Uri.parse(payload.uri))
        return {}
      }
    }
  }

  private registerWatchers(workspaceRoot: vscode.Uri): void {
    const sceneWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, "scene/*.txt"))
    const draftWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, "draft/**/*.md"))
    const projectWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, ".storyboard/project.json")
    )

    const refresh = (): void => {
      void this.refreshScenes()
    }

    this.disposables.push(
      sceneWatcher,
      draftWatcher,
      projectWatcher,
      sceneWatcher.onDidCreate(refresh),
      sceneWatcher.onDidChange(refresh),
      sceneWatcher.onDidDelete(refresh),
      draftWatcher.onDidCreate(refresh),
      draftWatcher.onDidChange(refresh),
      draftWatcher.onDidDelete(refresh),
      projectWatcher.onDidChange(refresh)
    )
  }

  private async refreshScenes(): Promise<void> {
    await this.webviewView?.webview.postMessage({
      type: "event",
      method: "scenes.listChanged",
      payload: await this.createInitialData()
    })
  }

  private async postUsageChanged(): Promise<void> {
    const root = await resolveStoryboardWorkspaceRoot()
    const summary =
      root !== undefined ? await this.dependencies.usageRecorder.getSummary(root) : emptyUsageSummary()

    await this.webviewView?.webview.postMessage({
      type: "event",
      method: "usage.changed",
      payload: summary
    })
  }

  private async createInitialData(): Promise<SidebarScenesInitialData> {
    const storyboardRoot = await resolveStoryboardWorkspaceRoot()
    const usage =
      storyboardRoot !== undefined
        ? await this.dependencies.usageRecorder.getSummary(storyboardRoot)
        : emptyUsageSummary()

    return {
      title: "Scenes",
      scenes: await this.loadSceneList(storyboardRoot),
      isStoryboardProject: storyboardRoot !== undefined,
      usage
    }
  }

  private async loadSceneList(workspaceRoot?: vscode.Uri): Promise<SceneListItem[]> {
    const root = workspaceRoot ?? (await resolveStoryboardWorkspaceRoot())

    if (!root) {
      return []
    }

    const paths = getStoryboardProjectPaths(root)
    const entries = await vscode.workspace.fs.readDirectory(paths.sceneDirectory)
    const sceneFiles = entries
      .filter(([, type]) => type === vscode.FileType.File)
      .map(([name]) => name)
      .filter((name) => parseSceneFileName(name) !== undefined)

    const items = await Promise.all(sceneFiles.map((name) => this.buildSceneListItem(root, name)))

    return items.sort((a, b) => a.order - b.order)
  }

  private async buildSceneListItem(workspaceRoot: vscode.Uri, fileName: string): Promise<SceneListItem> {
    const parts = parseSceneFileName(fileName)
    if (!parts) {
      throw new Error(`Invariant: invalid scene file name ${fileName}`)
    }

    const paths = getStoryboardProjectPaths(workspaceRoot)
    const sceneUri = vscode.Uri.joinPath(paths.sceneDirectory, fileName)
    const draftUri = draftPath(workspaceRoot, parts.stem)

    const sceneStat = await vscode.workspace.fs.stat(sceneUri)
    const sceneMtime = sceneStat.mtime ?? 0

    let draftMtime: number | undefined
    let draftUriString: string | undefined
    let status: SceneListItem["status"]

    try {
      const draftStat = await vscode.workspace.fs.stat(draftUri)
      draftMtime = draftStat.mtime ?? 0
      draftUriString = draftUri.toString()

      if (draftMtime >= sceneMtime) {
        status = "ready"
      } else {
        status = "stale"
      }
    } catch {
      status = "missing"
    }

    const title = await this.tryReadSceneTitle(sceneUri, fileName)

    return {
      stem: parts.stem,
      order: parts.order,
      slug: parts.slug,
      title,
      sceneUri: sceneUri.toString(),
      draftUri: draftUriString,
      status,
      sceneMtime,
      draftMtime
    }
  }

  private async tryReadSceneTitle(sceneUri: vscode.Uri, fileName: string): Promise<string | undefined> {
    try {
      const scene = await readSceneFile(sceneUri, vscodeFs, fileName)
      const rawTitle = scene.frontmatter.title
      const trimmed = rawTitle?.trim()
      return trimmed && trimmed.length > 0 ? trimmed : undefined
    } catch {
      return undefined
    }
  }
}

export function registerSidebarScenesProvider(
  context: vscode.ExtensionContext,
  dependencies: SidebarScenesProviderDependencies
): vscode.Disposable {
  const provider = new SidebarScenesProvider(context.extensionUri, dependencies)

  return vscode.Disposable.from(
    vscode.window.registerWebviewViewProvider(scenesSidebarViewId, provider),
    provider
  )
}
