import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { getStoryboardProjectPaths, type StoryboardProjectPaths } from "../core/pathConventions"
import {
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  type SceneContextWorkspaceFileSystem,
  type SceneContextWorkspacePaths
} from "../core/sceneContext"
import { hasStoryboardProject } from "../core/workspace"
import { parseDraft } from "../files/draft"
import { readSceneFile } from "../files/scene"
import { StoryboardAIService, type ContinuityIssue } from "../services/ai/AIService"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import type { UsageRecorder } from "../services/ai/UsageRecorder"

const continuityCheckCommand = "storyboard.draft.continuityCheck"
const continuitySource = "storyboard-continuity"

export interface RegisterContinuityDiagnosticsProviderDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
}

const vscodeFsAdapter = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

const sceneContextFileSystem: SceneContextWorkspaceFileSystem = {
  readFile: vscodeFsAdapter.readFile,
  writeFile: vscodeFsAdapter.writeFile,
  readDirectory: async (uri: unknown): Promise<[string, { type: "file" | "directory" }][]> => {
    const entries = await vscode.workspace.fs.readDirectory(uri as vscode.Uri)
    return entries.map(([name, fileType]) => [
      name,
      { type: fileType === vscode.FileType.Directory ? ("directory" as const) : ("file" as const) }
    ])
  }
}

function sceneContextPaths(paths: StoryboardProjectPaths): SceneContextWorkspacePaths {
  return {
    characterDirectory: paths.characterDirectory,
    backgroundDirectory: paths.backgroundDirectory,
    draftDirectory: paths.draftDirectory,
    bibleCanon: paths.bibleCanon,
    joinPath: (base: unknown, ...segments: string[]): vscode.Uri =>
      vscode.Uri.joinPath(base as vscode.Uri, ...segments)
  }
}

function isDraftMarkdownFile(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): boolean {
  const draftDir = vscode.Uri.joinPath(workspaceFolder.uri, "draft")
  const dirPath = draftDir.fsPath.replace(/\\/g, "/").toLowerCase()
  const filePath = uri.fsPath.replace(/\\/g, "/").toLowerCase()

  if (!filePath.startsWith(`${dirPath}/`)) {
    return false
  }

  const remainder = filePath.slice(dirPath.length + 1)
  return !remainder.includes("/") && remainder.endsWith(".md")
}

export function toContinuityRange(document: vscode.TextDocument, issue: ContinuityIssue): vscode.Range | undefined {
  const body = document.getText()
  if (issue.start < 0 || issue.end < issue.start || issue.end > body.length) {
    return undefined
  }

  const start = document.positionAt(issue.start)
  const end = document.positionAt(issue.end)
  const RangeCtor = (vscode as unknown as { Range?: typeof vscode.Range }).Range
  return RangeCtor ? new RangeCtor(start, end) : ({ start, end } as vscode.Range)
}

export function mapContinuityIssuesToDiagnostics(
  document: vscode.TextDocument,
  issues: readonly ContinuityIssue[]
): vscode.Diagnostic[] {
  const DiagnosticCtor = (vscode as unknown as { Diagnostic?: typeof vscode.Diagnostic }).Diagnostic
  const warningSeverity = (vscode.DiagnosticSeverity?.Warning ?? 1) as unknown as vscode.DiagnosticSeverity

  return issues.flatMap((issue) => {
    const range = toContinuityRange(document, issue)
    if (!range) {
      return []
    }

    const message = `설정 불일치: ${issue.reason}`
    const diagnostic = DiagnosticCtor
      ? new DiagnosticCtor(range, message, warningSeverity)
      : ({ range, message, severity: warningSeverity } as vscode.Diagnostic)
    diagnostic.source = continuitySource
    return [diagnostic]
  })
}

class ContinuityDiagnosticsController {
  private readonly collection = vscode.languages.createDiagnosticCollection(continuitySource)
  private readonly aiService: StoryboardAIService
  private currentWorkspaceUri: vscode.Uri | undefined

  public constructor(private readonly dependencies: RegisterContinuityDiagnosticsProviderDependencies) {
    this.aiService = new StoryboardAIService(dependencies.aiProviderRegistry, {
      onUsage: (record): void => {
        if (this.currentWorkspaceUri) {
          recordUsageSafely(dependencies.usageRecorder, this.currentWorkspaceUri, record, dependencies.logger)
        }
      }
    })
  }

  public getDiagnosticsCollection(): vscode.DiagnosticCollection {
    return this.collection
  }

  public async runForDocument(document: vscode.TextDocument): Promise<void> {
    if (!(await this.canRun(document))) {
      this.collection.delete(document.uri)
      return
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder) {
      this.collection.delete(document.uri)
      return
    }

    const paths = getStoryboardProjectPaths(workspaceFolder.uri)
    const sceneStem = resolveSceneStem(document)
    const sceneFileName = `${sceneStem}.txt`

    let factLines: string[]
    try {
      const scene = await readSceneFile(
        vscode.Uri.joinPath(paths.sceneDirectory, sceneFileName),
        vscodeFsAdapter,
        sceneFileName
      )
      const ctxPaths = sceneContextPaths(paths)
      const context = await buildSceneContext(ctxPaths, scene, sceneContextFileSystem)
      const narrative = await buildNarrativeContext(ctxPaths, context, sceneContextFileSystem)
      factLines = formatBibleFactLines(context, narrative.bibleFacts)
    } catch (error) {
      this.dependencies.logger.error("Continuity context build failed", error)
      this.collection.delete(document.uri)
      return
    }

    if (factLines.length === 0) {
      this.collection.delete(document.uri)
      return
    }

    this.currentWorkspaceUri = workspaceFolder.uri

    try {
      const issues = await this.aiService.checkContinuity(document.getText(), factLines, {
        providerId: this.dependencies.aiProviderRegistry.getTaskProvider("continuityCheck"),
        attribution: { primary: { kind: "scene", id: sceneStem } }
      })
      this.collection.set(document.uri, mapContinuityIssuesToDiagnostics(document, issues))
    } catch (error) {
      this.dependencies.logger.error("Continuity check failed", error)
      this.collection.delete(document.uri)
    }
  }

  public dispose(): void {
    this.collection.dispose()
  }

  private async canRun(document: vscode.TextDocument): Promise<boolean> {
    if (document.uri.scheme !== "file") {
      return false
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder) {
      return false
    }
    if (!(await hasStoryboardProject(workspaceFolder))) {
      return false
    }
    return isDraftMarkdownFile(document.uri, workspaceFolder)
  }
}

function resolveSceneStem(document: vscode.TextDocument): string {
  try {
    return parseDraft(document.getText()).sceneStem
  } catch {
    const fileName = document.uri.path.split("/").pop() ?? ""
    return fileName.replace(/\.md$/i, "")
  }
}

async function runContinuityCheckCommand(
  controller: ContinuityDiagnosticsController,
  uri?: vscode.Uri
): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri
  if (!targetUri) {
    await vscode.window.showErrorMessage("활성 드래프트 파일을 찾을 수 없습니다.")
    return
  }

  const document = await vscode.workspace.openTextDocument(targetUri)
  await controller.runForDocument(document)
}

export function registerContinuityDiagnosticsProvider(
  dependencies: RegisterContinuityDiagnosticsProviderDependencies
): vscode.Disposable {
  const controller = new ContinuityDiagnosticsController(dependencies)

  const commandRegistration = vscode.commands.registerCommand(continuityCheckCommand, (uri?: vscode.Uri) =>
    runContinuityCheckCommand(controller, uri)
  )
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    controller.getDiagnosticsCollection().delete(document.uri)
  })

  return vscode.Disposable.from(controller, commandRegistration, closeListener)
}
