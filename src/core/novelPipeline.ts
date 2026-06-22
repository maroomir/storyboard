import * as vscode from "vscode"

import { listCharacterBriefs } from "./characterBriefs"
import type { StoryboardLogger } from "./logger"
import { assembleManuscript } from "./manuscriptAssembly"
import { collectDraftsByOrder } from "./manuscriptDrafts"
import { buildManuscriptReviewMarkdown } from "./manuscriptReview"
import { buildChapterSummariesMarkdown, type ChapterSummary } from "./chapterSummaries"
import { buildForeshadowingMarkdown, collectForeshadowing } from "./foreshadowingTracker"
import { getStoryboardProjectPaths, type StoryboardProjectPaths } from "./pathConventions"
import { runReviseDraftWorkflow } from "./reviseDraftWorkflow"
import { recordRevisionEntry } from "./revisionPlanRecorder"
import { buildSceneSeeds } from "./sceneSeedFactory"
import { resolveScenePrefixDigitCount } from "../commands/scenePrefixDigits"
import { generateDraftForWorkspaceSceneWorkflow } from "../commands/generateDraft"
import { type CardFileSystem } from "../files/card"
import { readBibleFile, type BibleFileSystem } from "../files/bible"
import { type DraftFileSystem } from "../files/draft"
import {
  readChapterPlanFile,
  writeChapterPlanFile,
  writeSynopsisFile,
  type OutlineFileSystem
} from "../files/outline"
import {
  writeNovelRunState,
  type NovelRunMode,
  type NovelRunState,
  type NovelRunStateFileSystem,
  type NovelStageName
} from "../files/novelRunState"
import { StoryboardAIService } from "../services/ai/AIService"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import type { ConfigBridge } from "../services/settings/ConfigBridge"
import { flattenChapterPlan, toOutlineBrief, type ChapterPlan } from "../shared/outline"
import type { StoryboardProject } from "../shared/project"

const fileSystem: DraftFileSystem & OutlineFileSystem & BibleFileSystem & CardFileSystem & NovelRunStateFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

export interface NovelPipelineDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly configBridge: ConfigBridge
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
}

export type NovelApprovalKind = "outline" | "chapter"

export interface NovelPipelineOptions {
  readonly workspaceUri: vscode.Uri
  readonly project: StoryboardProject
  readonly deps: NovelPipelineDependencies
  readonly runMode: NovelRunMode
  readonly resumeState?: NovelRunState
  readonly reviseMaxIterations: number
  readonly onProgress: (stage: NovelStageName, message: string) => void
  readonly requestApproval: (kind: NovelApprovalKind, info: string) => Promise<boolean>
  readonly shouldCancel: () => boolean
}

export type NovelPipelineOutcome = "completed" | "paused" | "cancelled" | "failed"

export interface NovelPipelineResult {
  readonly outcome: NovelPipelineOutcome
  readonly message: string
}

interface ChapterGroup {
  readonly title: string
  readonly stems: readonly string[]
}

export async function runNovelPipeline(options: NovelPipelineOptions): Promise<NovelPipelineResult> {
  const paths = getStoryboardProjectPaths(options.workspaceUri)
  const completed = new Set<NovelStageName>(options.resumeState?.completedStages ?? [])
  const now = (): string => new Date().toISOString()

  const state: NovelRunState = {
    version: "1.0.0",
    runId: options.resumeState?.runId ?? cryptoRunId(),
    startedAt: options.resumeState?.startedAt ?? now(),
    updatedAt: now(),
    runMode: options.runMode,
    status: "running",
    completedStages: [...completed],
    nextChapterIndex: options.resumeState?.nextChapterIndex ?? 0
  }

  const persist = async (patch: Partial<NovelRunState>): Promise<void> => {
    Object.assign(state, { ...patch, updatedAt: now(), completedStages: [...completed] })
    await vscode.workspace.fs.createDirectory(paths.cacheDirectory)
    await writeNovelRunState(paths.novelRunState, fileSystem, state)
  }

  const newAiService = (): StoryboardAIService =>
    new StoryboardAIService(options.deps.aiProviderRegistry, {
      onUsage: (record): void => {
        recordUsageSafely(options.deps.usageRecorder, options.workspaceUri, record, options.deps.logger)
      }
    })

  const runStageOnce = async (
    stage: NovelStageName,
    label: string,
    run: () => Promise<void>
  ): Promise<void> => {
    if (completed.has(stage)) {
      return
    }
    options.onProgress(stage, label)
    await run()
    completed.add(stage)
    await persist({})
  }

  try {
    await persist({ status: "running" })

    if (!completed.has("outline")) {
      await runStageOnce("outline", "아웃라인 생성 중…", () =>
        runOutlineStage(paths, options.project, newAiService())
      )

      if (options.runMode !== "auto") {
        const approved = await options.requestApproval(
          "outline",
          "아웃라인(synopsis.md, chapters.yaml)을 검토하세요. 계속할까요?"
        )
        if (!approved) {
          await persist({ status: "paused" })
          return { outcome: "paused", message: "아웃라인 승인 대기에서 멈췄습니다." }
        }
      }
    }
    if (options.shouldCancel()) {
      return await cancel(persist)
    }

    const plan = await readChapterPlanFile(paths.outlineChapters, fileSystem)
    const digitCount = resolveScenePrefixDigitCount(
      options.project.editor.scenePrefixDigits,
      vscode.workspace.getConfiguration("storyboard").inspect<number>("scene.prefixDigits")
    )
    const groups = groupChapterStems(plan, digitCount)

    await runStageOnce("seeds", "씬 시드 생성 중…", () => runSeedsStage(paths, plan, digitCount))
    if (options.shouldCancel()) {
      return await cancel(persist)
    }

    if (!completed.has("chapters")) {
      for (let chapterIndex = state.nextChapterIndex; chapterIndex < groups.length; chapterIndex += 1) {
        const group = groups[chapterIndex]
        if (!group) {
          continue
        }
        options.onProgress(
          "chapters",
          `${chapterIndex + 1}/${groups.length}장 «${group.title}» 초안·검수 중…`
        )

        await runChapterDraftsAndRevise(group, paths, options)

        await persist({ nextChapterIndex: chapterIndex + 1 })

        if (options.shouldCancel()) {
          return await cancel(persist)
        }

        const isLastChapter = chapterIndex === groups.length - 1
        if (options.runMode === "chapter-approval" && !isLastChapter) {
          const approved = await options.requestApproval(
            "chapter",
            `${chapterIndex + 1}장을 마쳤습니다. 다음 장으로 진행할까요?`
          )
          if (!approved) {
            await persist({ status: "paused" })
            return { outcome: "paused", message: `${chapterIndex + 1}장까지 진행하고 멈췄습니다.` }
          }
        }
      }

      completed.add("chapters")
      await persist({})
    }
    if (options.shouldCancel()) {
      return await cancel(persist)
    }

    await runStageOnce("assemble", "원고 조립 중…", () =>
      runAssembleStage(paths, options.project, plan)
    )

    await runStageOnce("review", "원고 최종 검사 중…", () =>
      runReviewStage(paths, options.project, plan, newAiService(), options.deps.aiProviderRegistry)
    )

    await runStageOnce("summaries", "장별 요약 중…", () =>
      runSummariesStage(paths, options.project, plan, newAiService(), options.deps.aiProviderRegistry)
    )

    await persist({ status: "done" })
    return { outcome: "completed", message: "장편 생성을 완료했습니다." }
  } catch (error) {
    options.deps.logger.error("Novel pipeline failed", error)
    const message = error instanceof Error ? error.message : String(error)
    await persist({ status: "failed", lastError: message }).catch(() => undefined)
    return { outcome: "failed", message }
  }
}

async function cancel(
  persist: (patch: Partial<NovelRunState>) => Promise<void>
): Promise<NovelPipelineResult> {
  await persist({ status: "paused" })
  return { outcome: "cancelled", message: "실행을 취소했습니다. 다시 실행하면 이어서 진행합니다." }
}

async function runOutlineStage(
  paths: StoryboardProjectPaths,
  project: StoryboardProject,
  aiService: StoryboardAIService
): Promise<void> {
  const brief = toOutlineBrief(project)
  const synopsis = await aiService.generateOutlineSynopsis(brief)
  const characters = await listCharacterBriefs(paths.characterDirectory, fileSystem)
  const chapterPlan = await aiService.generateChapterPlan(brief, synopsis, characters)

  await vscode.workspace.fs.createDirectory(paths.outlineDirectory)
  await writeSynopsisFile(paths.outlineSynopsis, fileSystem, synopsis)
  await writeChapterPlanFile(paths.outlineChapters, fileSystem, chapterPlan)
}

async function runSeedsStage(
  paths: StoryboardProjectPaths,
  plan: ChapterPlan,
  digitCount: number
): Promise<void> {
  await vscode.workspace.fs.createDirectory(paths.sceneDirectory)

  for (const seed of buildSceneSeeds(plan, digitCount)) {
    const sceneUri = vscode.Uri.joinPath(paths.sceneDirectory, seed.fileName)
    await vscode.workspace.fs.writeFile(sceneUri, new TextEncoder().encode(seed.content))
  }
}

async function runChapterDraftsAndRevise(
  group: ChapterGroup,
  paths: StoryboardProjectPaths,
  options: NovelPipelineOptions
): Promise<void> {
  for (const stem of group.stems) {
    if (options.shouldCancel()) {
      return
    }

    const sceneUri = vscode.Uri.joinPath(paths.sceneDirectory, `${stem}.txt`)
    const draftResult = await generateDraftForWorkspaceSceneWorkflow(sceneUri, {
      force: false,
      aiProviderRegistry: options.deps.aiProviderRegistry,
      configBridge: options.deps.configBridge,
      logger: options.deps.logger,
      usageRecorder: options.deps.usageRecorder,
      openDocumentOnSuccess: false,
      showCacheHitMessage: false,
      showSuccessMessage: false,
      suppressLoggerPanel: true,
      shouldCancel: options.shouldCancel
    })

    if (!draftResult.ok) {
      if (draftResult.kind === "cancelled") {
        return
      }
      throw new Error(`초안 생성 실패(${stem}): ${draftResult.message}`)
    }

    const reviseResult = await runReviseDraftWorkflow({
      aiProviderRegistry: options.deps.aiProviderRegistry,
      usageRecorder: options.deps.usageRecorder,
      logger: options.deps.logger,
      workspaceUri: options.workspaceUri,
      paths,
      draftUri: vscode.Uri.joinPath(paths.draftDirectory, `${stem}.md`),
      sceneStem: stem,
      maxIterations: options.reviseMaxIterations,
      reviseScoreThreshold: 0,
      shouldCancel: options.shouldCancel
    })

    await recordRevisionEntry(paths, {
      sceneStem: stem,
      checkedAt: new Date().toISOString(),
      revisionCount: reviseResult.revisionCount,
      remainingBlocking: reviseResult.remainingBlocking,
      instructions: reviseResult.instructions
    })
  }
}

async function loadAssembledManuscript(
  paths: StoryboardProjectPaths,
  project: StoryboardProject,
  plan: ChapterPlan
): Promise<ReturnType<typeof assembleManuscript>> {
  const draftsByOrder = await collectDraftsByOrder(paths, fileSystem, { warn: () => undefined })
  return assembleManuscript({ plan, projectName: project.name, draftsByOrder })
}

async function runAssembleStage(
  paths: StoryboardProjectPaths,
  project: StoryboardProject,
  plan: ChapterPlan
): Promise<void> {
  const manuscript = await loadAssembledManuscript(paths, project, plan)

  await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory)

  for (const chapter of manuscript.chapters) {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(paths.manuscriptDirectory, chapter.fileName),
      new TextEncoder().encode(chapter.markdown)
    )
  }
  await vscode.workspace.fs.writeFile(
    paths.manuscriptVolume,
    new TextEncoder().encode(manuscript.volumeMarkdown)
  )
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(paths.manuscriptDirectory, "FORESHADOWING.md"),
    new TextEncoder().encode(buildForeshadowingMarkdown(project.name, collectForeshadowing(plan)))
  )
}

async function runReviewStage(
  paths: StoryboardProjectPaths,
  project: StoryboardProject,
  plan: ChapterPlan,
  aiService: StoryboardAIService,
  registry: AiProviderRegistry
): Promise<void> {
  const manuscript = await loadAssembledManuscript(paths, project, plan)
  const factLines = await loadCanonFactLines(paths.bibleCanon)
  const characters = collectCharacterIds(plan)

  const [continuityIssues, critiqueIssues] = await Promise.all([
    aiService.checkContinuity(manuscript.volumeMarkdown, factLines, {
      providerId: registry.getTaskProvider("continuityCheck")
    }),
    aiService.critiqueDraft(
      {
        body: manuscript.volumeMarkdown,
        intent: "전체 원고 최종 검수",
        characters,
        facts: factLines,
        styleConstraints: project.setting?.styleConstraints ?? [],
        qualityCriteria: project.setting?.qualityCriteria ?? []
      },
      { providerId: registry.getTaskProvider("draftCritique") }
    )
  ])

  const reportMarkdown = buildManuscriptReviewMarkdown({
    projectName: project.name,
    sceneCount: manuscript.includedCount,
    generatedAt: new Date().toISOString(),
    continuityIssues,
    critiqueIssues
  })

  await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory)
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(paths.manuscriptDirectory, "REVIEW.md"),
    new TextEncoder().encode(reportMarkdown)
  )
}

async function runSummariesStage(
  paths: StoryboardProjectPaths,
  project: StoryboardProject,
  plan: ChapterPlan,
  aiService: StoryboardAIService,
  registry: AiProviderRegistry
): Promise<void> {
  const manuscript = await loadAssembledManuscript(paths, project, plan)
  const providerId = registry.getTaskProvider("chapterSummary")

  const summaries: ChapterSummary[] = []
  for (const chapter of manuscript.chapters) {
    const summary = await aiService.summarizeChapter(
      { chapterTitle: chapter.chapterTitle, body: chapter.markdown },
      { providerId }
    )
    summaries.push({ chapterTitle: chapter.chapterTitle, summary })
  }

  await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory)
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(paths.manuscriptDirectory, "SUMMARY.md"),
    new TextEncoder().encode(buildChapterSummariesMarkdown(project.name, summaries))
  )
}

function groupChapterStems(plan: ChapterPlan, digitCount: number): ChapterGroup[] {
  const seeds = buildSceneSeeds(plan, digitCount)
  const flat = flattenChapterPlan(plan)
  const groups: { title: string; stems: string[]; actIndex: number; chapterIndex: number }[] = []

  flat.forEach((flatScene, index) => {
    const stem = seeds[index]?.stem
    if (stem === undefined) {
      return
    }

    const last = groups.at(-1)
    if (last && last.actIndex === flatScene.actIndex && last.chapterIndex === flatScene.chapterIndex) {
      last.stems.push(stem)
      return
    }
    groups.push({
      title: flatScene.chapterTitle,
      stems: [stem],
      actIndex: flatScene.actIndex,
      chapterIndex: flatScene.chapterIndex
    })
  })

  return groups.map(({ title, stems }) => ({ title, stems }))
}

async function loadCanonFactLines(bibleCanonUri: vscode.Uri): Promise<string[]> {
  try {
    const bible = await readBibleFile(bibleCanonUri, fileSystem)
    return bible.facts
      .filter((fact) => fact.status === "canon")
      .map((fact) => `${fact.subject.id} — ${fact.key}: ${fact.value}`)
  } catch {
    return []
  }
}

function collectCharacterIds(plan: ChapterPlan): string[] {
  const ids = new Set<string>()
  for (const flatScene of flattenChapterPlan(plan)) {
    for (const id of flatScene.scene.characters) {
      ids.add(id)
    }
  }
  return [...ids]
}

function cryptoRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
