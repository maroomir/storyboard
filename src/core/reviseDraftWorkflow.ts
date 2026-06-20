import * as vscode from "vscode"

import type { StoryboardLogger } from "./logger"
import { type StoryboardProjectPaths } from "./pathConventions"
import {
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  type SceneContextWorkspaceFileSystem,
  type SceneContextWorkspacePaths
} from "./sceneContext"
import { createDraft, parseDraft, readDraftFile, writeDraftFile, type DraftFileSystem } from "../files/draft"
import { readSceneFile } from "../files/scene"
import { StoryboardAIService } from "../services/ai/AIService"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import { buildRevisionInstructions, countBlockingIssues } from "../shared/draftReview"

const vscodeFsAdapter: DraftFileSystem = {
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

export interface ReviseDraftWorkflowOptions {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly usageRecorder: UsageRecorder
  readonly logger: StoryboardLogger
  readonly workspaceUri: vscode.Uri
  readonly paths: StoryboardProjectPaths
  readonly draftUri: vscode.Uri
  readonly sceneStem: string
  readonly maxIterations: number
  readonly onProgress?: (message: string) => void
  readonly shouldCancel?: () => boolean
}

export interface ReviseDraftWorkflowResult {
  readonly passed: boolean
  readonly revisionCount: number
  readonly remainingBlocking: number
  readonly cancelled: boolean
  readonly instructions: readonly string[]
}

export async function runReviseDraftWorkflow(
  options: ReviseDraftWorkflowOptions
): Promise<ReviseDraftWorkflowResult> {
  const { aiProviderRegistry: registry, paths, draftUri, sceneStem, maxIterations } = options
  const isCancelled = (): boolean => options.shouldCancel?.() ?? false

  const aiService = new StoryboardAIService(registry, {
    onUsage: (record): void => {
      recordUsageSafely(options.usageRecorder, options.workspaceUri, record, options.logger)
    }
  })
  const attribution = { primary: { kind: "scene" as const, id: sceneStem } }

  const sceneFileName = `${sceneStem}.txt`
  const scene = await readSceneFile(
    vscode.Uri.joinPath(paths.sceneDirectory, sceneFileName),
    vscodeFsAdapter,
    sceneFileName
  )
  const ctxPaths = sceneContextPaths(paths)
  const context = await buildSceneContext(ctxPaths, scene, sceneContextFileSystem)
  const narrative = await buildNarrativeContext(ctxPaths, context, sceneContextFileSystem)
  const factLines = formatBibleFactLines(context, narrative.bibleFacts)
  const characterNames = context.characters.map((character) => character.name)
  const intent = scene.body

  const draft = parseDraft(await readDraftFile(draftUri, vscodeFsAdapter))
  let body = draft.body
  let revisionCount = 0
  let blocking = 0
  let passed = false
  let lastInstructions: string[] = []

  while (!isCancelled()) {
    options.onProgress?.(`검사 중 (${revisionCount + 1}/${maxIterations + 1})…`)

    const [continuityIssues, critiqueIssues] = await Promise.all([
      aiService.checkContinuity(body, factLines, {
        providerId: registry.getTaskProvider("continuityCheck"),
        attribution
      }),
      aiService.critiqueDraft(
        { body, intent, characters: characterNames, facts: factLines },
        { providerId: registry.getTaskProvider("draftCritique"), attribution }
      )
    ])

    blocking = countBlockingIssues(continuityIssues, critiqueIssues)
    lastInstructions = buildRevisionInstructions(continuityIssues, critiqueIssues)

    if (blocking === 0) {
      passed = true
      break
    }

    if (revisionCount >= maxIterations || isCancelled()) {
      break
    }

    options.onProgress?.(`재작성 중 (${revisionCount + 1}/${maxIterations})…`)

    body = await aiService.reviseDraft(
      {
        body,
        format: draft.format,
        instructions: lastInstructions,
        intent,
        facts: factLines
      },
      { providerId: registry.getTaskProvider("draftRevision"), attribution }
    )

    await writeDraftFile(draftUri, vscodeFsAdapter, createDraft({ sceneStem, format: draft.format, body }))
    revisionCount += 1
  }

  return {
    passed,
    revisionCount,
    remainingBlocking: blocking,
    cancelled: isCancelled(),
    instructions: lastInstructions
  }
}
