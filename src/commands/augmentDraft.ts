import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import {
  draftHistorySceneDirectory,
  getStoryboardProjectPaths,
  isDraftMarkdownFile,
  sceneFilePath
} from "../core/pathConventions"
import {
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  type SceneContext
} from "../core/sceneContext"
import {
  draftHistoryFileSystem,
  sceneContextFileSystem,
  sceneContextPaths,
  vscodeFsAdapter
} from "../core/vscodeFileSystem"
import { hasStoryboardProject } from "../core/workspace"
import type { Draft } from "../domain/Draft"
import { createDraft, parseDraft, serializeDraft } from "../files/draft"
import { archiveExistingDraft } from "../files/draftHistory"
import { readProjectJson } from "../files/projectJson"
import { readSceneFile, SceneParseError } from "../files/scene"
import { tryParseDraftScenePartsForCodeLens } from "../providers/draftCodeLensLogic"
import { StoryboardAIService } from "../services/ai/AIService"
import { formatAugmentCards, type DraftAugmentScope } from "../services/ai/prompts/draftAugment"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import type { ConfigBridge } from "../services/settings/ConfigBridge"
import type { BibleFact } from "../shared/bible"
import type { ProjectFormat } from "../shared/project"
import { resolveExpandRange } from "./expandDraft"

const augmentDraftCommand = "storyboard.draft.augment"
const augmentSelectionCommand = "storyboard.draft.augmentSelection"
const editSelectionCommand = "storyboard.draft.editSelection"
const augmentPreviewScheme = "storyboard-augment"

export interface RegisterAugmentDraftCommandDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly configBridge: ConfigBridge
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
}

// NOTE: Serves the proposed draft body as a read-only virtual document so the augment preview can
// reuse VSCode's native diff editor (left = real draft file, right = this proposed content).
class AugmentPreviewContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contentByUri = new Map<string, string>()
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>()
  public readonly onDidChange = this.changeEmitter.event

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentByUri.get(uri.toString()) ?? ""
  }

  public setContent(uri: vscode.Uri, content: string): void {
    this.contentByUri.set(uri.toString(), content)
    this.changeEmitter.fire(uri)
  }

  public dispose(): void {
    this.changeEmitter.dispose()
  }
}

function augmentPreviewUri(draftUri: vscode.Uri): vscode.Uri {
  const baseName = (draftUri.path.split("/").at(-1) ?? "draft.md").replace(/\.md$/, "")
  return vscode.Uri.from({ scheme: augmentPreviewScheme, path: `/${baseName}.md`, query: draftUri.toString() })
}

interface AugmentReplacement {
  readonly range: vscode.Range
  readonly text: string
}

type AugmentContextResult =
  | { readonly ok: true; readonly format: ProjectFormat; readonly sceneContext: SceneContext; readonly bibleFacts: readonly BibleFact[] }
  | { readonly ok: false; readonly message: string }

function deriveSceneUri(workspaceFolder: vscode.WorkspaceFolder, documentText: string): vscode.Uri | undefined {
  const parts = tryParseDraftScenePartsForCodeLens(documentText)
  if (!parts) {
    return undefined
  }

  return sceneFilePath(workspaceFolder.uri, parts.orderText, parts.slug)
}

async function loadAugmentContext(
  sceneUri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder
): Promise<AugmentContextResult> {
  const fileName = sceneUri.path.split("/").pop() ?? ""

  let scene
  try {
    scene = await readSceneFile(sceneUri, vscodeFsAdapter, fileName)
  } catch (error) {
    if (error instanceof SceneParseError) {
      return { ok: false, message: `연결된 씬 파일을 읽을 수 없습니다: ${error.message}` }
    }

    return { ok: false, message: "연결된 씬 파일을 찾을 수 없습니다." }
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri)

  let project
  try {
    project = await readProjectJson(paths.projectJson)
  } catch {
    return { ok: false, message: "project.json을 읽을 수 없습니다." }
  }

  const ctxPaths = sceneContextPaths(paths)

  let sceneContext
  try {
    sceneContext = await buildSceneContext(ctxPaths, scene, sceneContextFileSystem)
  } catch {
    return { ok: false, message: "씬 컨텍스트를 구성하지 못했습니다." }
  }

  const narrativeContext = await buildNarrativeContext(ctxPaths, sceneContext, sceneContextFileSystem)

  return { ok: true, format: project.format, sceneContext, bibleFacts: narrativeContext.bibleFacts }
}

function buildReplacement(
  scope: DraftAugmentScope,
  document: vscode.TextDocument,
  selectionRange: vscode.Range,
  draft: Draft,
  augmented: string
): AugmentReplacement {
  if (scope === "selection") {
    return { range: new vscode.Range(selectionRange.start, selectionRange.end), text: augmented }
  }

  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))
  const serialized = serializeDraft(
    createDraft({
      sceneStem: draft.sceneStem,
      format: draft.format,
      body: augmented,
      generatedAt: draft.generatedAt
    })
  )

  return { range: fullRange, text: serialized }
}

function applyReplacementToText(
  documentText: string,
  document: vscode.TextDocument,
  replacement: AugmentReplacement
): string {
  const startOffset = document.offsetAt(replacement.range.start)
  const endOffset = document.offsetAt(replacement.range.end)

  return documentText.slice(0, startOffset) + replacement.text + documentText.slice(endOffset)
}

async function maybeArchiveDraft(
  dependencies: RegisterAugmentDraftCommandDependencies,
  workspaceFolder: vscode.WorkspaceFolder,
  sceneStem: string,
  draftUri: vscode.Uri
): Promise<void> {
  if (!dependencies.configBridge.isKeepDraftHistoryEnabled()) {
    return
  }

  const historyDirectory = draftHistorySceneDirectory(workspaceFolder.uri, sceneStem)

  try {
    await archiveExistingDraft({
      draftUri,
      historyDirectory,
      resolveArchiveUri: (archiveFileName) => vscode.Uri.joinPath(historyDirectory, archiveFileName),
      fileSystem: draftHistoryFileSystem
    })
  } catch (error) {
    dependencies.logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`)
  }
}

async function runAugmentDraft(
  scope: DraftAugmentScope,
  dependencies: RegisterAugmentDraftCommandDependencies,
  previewProvider: AugmentPreviewContentProvider,
  invokedSceneUri?: vscode.Uri,
  invokedDraftUri?: vscode.Uri,
  rangeArg?: vscode.Range,
  instruction?: string
): Promise<void> {
  const editor = vscode.window.activeTextEditor

  if (!editor || editor.document.uri.scheme !== "file") {
    await vscode.window.showErrorMessage("활성 드래프트 파일을 열고 다시 시도해 주세요.")
    return
  }

  if (invokedDraftUri && editor.document.uri.toString() !== invokedDraftUri.toString()) {
    await vscode.window.showErrorMessage("현재 활성화된 드래프트 파일에서만 보충을 실행할 수 있습니다.")
    return
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri)

  if (!workspaceFolder) {
    await vscode.window.showErrorMessage("워크스페이스 폴더를 찾을 수 없습니다.")
    return
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage("Storyboard 프로젝트(.storyboard/project.json)가 없습니다.")
    return
  }

  if (!isDraftMarkdownFile(editor.document.uri, workspaceFolder)) {
    await vscode.window.showErrorMessage("`draft/*.md` 파일에서만 보충할 수 있습니다.")
    return
  }

  const documentText = editor.document.getText()

  let draft: Draft
  try {
    draft = parseDraft(documentText)
  } catch {
    await vscode.window.showErrorMessage("드래프트 형식을 해석할 수 없습니다. frontmatter를 확인해 주세요.")
    return
  }

  const selectionRange = resolveExpandRange(editor, rangeArg)

  if (scope === "selection" && selectionRange.isEmpty) {
    await vscode.window.showInformationMessage(instruction ? "수정할 영역을 먼저 선택해 주세요." : "보충할 영역을 먼저 선택해 주세요.")
    return
  }

  const target = scope === "selection" ? editor.document.getText(selectionRange).trim() : draft.body.trim()

  if (target.length === 0) {
    await vscode.window.showInformationMessage("보충할 본문이 비어 있습니다.")
    return
  }

  const sceneUri = invokedSceneUri ?? deriveSceneUri(workspaceFolder, documentText)

  if (!sceneUri) {
    await vscode.window.showErrorMessage("연결된 씬 파일을 찾을 수 없습니다.")
    return
  }

  const context = await loadAugmentContext(sceneUri, workspaceFolder)

  if (!context.ok) {
    await vscode.window.showErrorMessage(context.message)
    return
  }

  const aiService = new StoryboardAIService(dependencies.aiProviderRegistry, {
    onUsage: (record): void => {
      recordUsageSafely(dependencies.usageRecorder, workspaceFolder.uri, record, dependencies.logger)
    }
  })

  let augmented: string
  try {
    augmented = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: instruction ? "Storyboard 선택 영역 편집" : scope === "selection" ? "Storyboard 선택 영역 보충" : "Storyboard 초안 보충",
        cancellable: false
      },
      async () =>
        aiService.augmentDraft(
          {
            target,
            scope,
            format: context.format,
            cards: formatAugmentCards(context.sceneContext.characters, context.sceneContext.background),
            facts: formatBibleFactLines(context.sceneContext, context.bibleFacts),
            intent: context.sceneContext.scene.body,
            instruction
          },
          {
            providerId: dependencies.aiProviderRegistry.getTaskProvider("draftAugment"),
            attribution: { primary: { kind: "scene", id: draft.sceneStem } }
          }
        )
    )
  } catch (error) {
    dependencies.logger.error("Augment draft failed", error)
    dependencies.logger.show()
    const message = error instanceof Error ? error.message : String(error)
    await vscode.window.showErrorMessage(`초안 보충에 실패했습니다: ${message}`)
    return
  }

  if (augmented.trim().length === 0) {
    await vscode.window.showWarningMessage("보충 결과가 비어 있어 적용하지 않았습니다.")
    return
  }

  const replacement = buildReplacement(scope, editor.document, selectionRange, draft, augmented)
  const proposedFullText = applyReplacementToText(documentText, editor.document, replacement)
  const previewUri = augmentPreviewUri(editor.document.uri)

  previewProvider.setContent(previewUri, proposedFullText)

  await vscode.commands.executeCommand(
    "vscode.diff",
    editor.document.uri,
    previewUri,
    instruction ? "초안 ↔ 수정 제안" : "초안 ↔ 보충 제안",
    { preview: true }
  )

  const decision = await vscode.window.showInformationMessage(
    instruction ? "수정 결과를 적용하시겠습니까?" : "보충 결과를 적용하시겠습니까?",
    "적용",
    "취소"
  )

  if (decision !== "적용") {
    return
  }

  await maybeArchiveDraft(dependencies, workspaceFolder, draft.sceneStem, editor.document.uri)

  const edit = new vscode.WorkspaceEdit()
  edit.replace(editor.document.uri, replacement.range, replacement.text)
  const applied = await vscode.workspace.applyEdit(edit)

  if (!applied) {
    await vscode.window.showErrorMessage("보충 결과를 적용하지 못했습니다.")
    return
  }

  await editor.document.save()
  await vscode.window.showInformationMessage(
    instruction ? "선택 영역을 수정했습니다." : scope === "selection" ? "선택 영역을 보충했습니다." : "초안을 보충했습니다."
  )
}

export function registerAugmentDraftCommands(
  dependencies: RegisterAugmentDraftCommandDependencies
): vscode.Disposable {
  const previewProvider = new AugmentPreviewContentProvider()

  return vscode.Disposable.from(
    previewProvider,
    vscode.workspace.registerTextDocumentContentProvider(augmentPreviewScheme, previewProvider),
    vscode.commands.registerCommand(
      augmentDraftCommand,
      (sceneUri?: vscode.Uri, draftUri?: vscode.Uri) =>
        runAugmentDraft("draft", dependencies, previewProvider, sceneUri, draftUri)
    ),
    vscode.commands.registerCommand(
      augmentSelectionCommand,
      (sceneUri?: vscode.Uri, draftUri?: vscode.Uri, rangeArg?: vscode.Range) =>
        runAugmentDraft("selection", dependencies, previewProvider, sceneUri, draftUri, rangeArg)
    ),
    vscode.commands.registerCommand(
      editSelectionCommand,
      async (sceneUri?: vscode.Uri, draftUri?: vscode.Uri, rangeArg?: vscode.Range) => {
        const instruction = await vscode.window.showInputBox({
          title: "선택 영역 편집",
          prompt: "어떻게 수정할까요?",
          placeHolder: "예: 더 긴장감 있게, 캐릭터 감정을 강조해서, 짧게 줄여서...",
          ignoreFocusOut: true
        })
        if (instruction === undefined) return
        if (!instruction.trim()) {
          await vscode.window.showInformationMessage("수정 지시문을 입력해 주세요.")
          return
        }
        return runAugmentDraft("selection", dependencies, previewProvider, sceneUri, draftUri, rangeArg, instruction)
      }
    )
  )
}
