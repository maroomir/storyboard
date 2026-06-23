import * as vscode from "vscode"

import type { StoryboardLogger } from "./logger"
import { type StoryboardProjectPaths } from "./pathConventions"
import { buildNarrativeContext, buildSceneContext, formatBibleFactLines } from "./sceneContext"
import { sceneContextFileSystem, sceneContextPaths, vscodeFsAdapter } from "./vscodeFileSystem"
import { createDraft, parseDraft, readDraftFile, writeDraftFile } from "../files/draft"
import { readProjectJson } from "../files/projectJson"
import { readSceneFile } from "../files/scene"
import { StoryboardAIService } from "../services/ai/AIService"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import { buildRevisionInstructions, countBlockingIssues, scoreCritique, shouldPassRevise } from "../shared/draftReview"
import {
  adaptContinuityIssues,
  adaptCritiqueIssues,
  buildScopedInstructions,
  routeReviewIssues
} from "../shared/reviewRouting"
import type { ProjectSetting } from "../shared/project"
import { buildStyleDirective } from "../shared/styleDirective"

async function readContractGuidance(
  projectJsonUri: vscode.Uri
): Promise<{ styleConstraints: readonly string[]; qualityCriteria: readonly string[]; setting?: ProjectSetting }> {
  try {
    const project = await readProjectJson(projectJsonUri)
    return {
      styleConstraints: project.setting?.styleConstraints ?? [],
      qualityCriteria: project.setting?.qualityCriteria ?? [],
      setting: project.setting
    }
  } catch {
    return { styleConstraints: [], qualityCriteria: [] }
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
  readonly reviseScoreThreshold: number
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
  const { styleConstraints, qualityCriteria, setting } = await readContractGuidance(paths.projectJson)
  const styleDirective = buildStyleDirective(setting, scene.frontmatter.relationStage)

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
        { body, intent, characters: characterNames, facts: factLines, styleConstraints, qualityCriteria, styleDirective },
        { providerId: registry.getTaskProvider("draftCritique"), attribution }
      )
    ])

    blocking = countBlockingIssues(continuityIssues, critiqueIssues)
    lastInstructions = buildRevisionInstructions(continuityIssues, critiqueIssues)

    const score = scoreCritique(critiqueIssues)
    const highContinuityCount = continuityIssues.filter((issue) => issue.severity === "high").length

    if (
      shouldPassRevise({
        blocking,
        score: score.overall,
        threshold: options.reviseScoreThreshold,
        highContinuityCount
      })
    ) {
      passed = true
      break
    }

    if (revisionCount >= maxIterations || isCancelled()) {
      break
    }

    options.onProgress?.(`재작성 중 (${revisionCount + 1}/${maxIterations})…`)

    const reviewIssues = [
      ...adaptContinuityIssues(continuityIssues),
      ...adaptCritiqueIssues(critiqueIssues, context.characters)
    ]
    const routing = routeReviewIssues(reviewIssues)
    const cardNameById = new Map(context.characters.map((character) => [character.id, character.name] as const))

    // 타깃 그룹은 에이전트별로 스코프 재작성하고, 타깃 없는 전역 이슈만 전체 재작성으로 한 번 더 덮는다.
    const revisionPasses =
      routing.groups.length > 0
        ? [
            ...routing.groups.map((group) =>
              buildScopedInstructions(group, (cardId) => cardNameById.get(cardId))
            ),
            ...(routing.global.length > 0 ? [lastInstructions] : [])
          ]
        : [lastInstructions]

    let appliedAnyPass = false

    for (const instructions of revisionPasses) {
      if (isCancelled()) {
        break
      }

      body = await aiService.reviseDraft(
        {
          body,
          format: draft.format,
          instructions,
          intent,
          facts: factLines
        },
        { providerId: registry.getTaskProvider("draftRevision"), attribution }
      )
      appliedAnyPass = true
    }

    if (!appliedAnyPass) {
      break
    }

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
