import nodeFs from "node:fs/promises"
import path from "node:path"

import { test } from "vitest"

import {
  runSceneGenerationPipeline,
  type BackgroundMemoryStore,
  type PersonaMemoryStore
} from "@/application/pipelines/sceneGenerationPipeline"
import { buildNarrativeContext, buildSceneContext, formatBibleFactLines, type SceneContext } from "@/domain/sceneContext"
import {
  computeBackgroundCardHash,
  computePersonaCardHash,
  readBackgroundMemoryFile,
  readPersonaMemoryFile,
  writeBackgroundMemoryFile,
  writePersonaMemoryFile
} from "@/domain/files/cardMemory"
import { createDraft, serializeDraft } from "@/domain/files/draft"
import { archiveExistingDraft } from "@/domain/files/draftHistory"
import { readSceneFile } from "@/domain/files/scene"
import { StoryboardAIService } from "@/infrastructure/ai/AIService"
import type { AiProviderRegistry } from "@/infrastructure/ai/providerRegistry"
import { ClaudeCodeProvider } from "@/infrastructure/ai/providers/ClaudeCodeProvider"
import { CodexProvider } from "@/infrastructure/ai/providers/CodexProvider"
import { createDefaultCliRunner, type CliRunResult } from "@/infrastructure/ai/providers/cliRunner"
import type { AiProviderId } from "@/shared/ai"
import type { AiGenerateRequest, AiGenerateResponse, AiProvider } from "@/shared/aiTypes"
import type { BackgroundCard, CharacterCard } from "@/shared/card"
import { buildRevisionInstructions, countBlockingIssues, scoreCritique, shouldPassRevise } from "@/shared/draftReview"
import type { ProjectFormat } from "@/shared/project"
import {
  adaptContinuityIssues,
  adaptCritiqueIssues,
  buildScopedInstructions,
  routeReviewIssues
} from "@/shared/reviewRouting"
import { buildStyleDirective } from "@/shared/styleDirective"

// NOTE: reasoning calls can exceed the provider's 180s default; lengthen only in the harness so a
// single slow beat does not abort a full long-form regeneration.
const harnessCliTimeoutMs = 600_000

// NOTE: codex (gpt-5.5) is the default; on codex usage-limit fall back to claude-code (sonnet) via
// SCENE_PROVIDER=claude-code, per the project's provider fallback policy. Project-neutral SCENE_*
// vars are preferred; the legacy GUERRILA_* names still work as a fallback.
const harnessProviderId = (process.env.SCENE_PROVIDER ?? process.env.GUERRILA_PROVIDER ?? "codex") as AiProviderId
const harnessModel =
  process.env.SCENE_MODEL ??
  process.env.GUERRILA_MODEL ??
  (harnessProviderId === "claude-code" ? "claude-sonnet-4-6" : "gpt-5.5")
const harnessCommand = harnessProviderId === "claude-code" ? "claude" : "codex"

// NOTE: SCENE_EFFORT=minimal|low|medium|high — codex 전용 reasoning effort. 미지정 시 CLI 기본값.
const harnessReasoningEffort = process.env.SCENE_EFFORT ?? process.env.GUERRILA_EFFORT

// NOTE: Headless harness that drives the REAL scene-generation pipeline against the codex CLI so
// the guerrila draft can be regenerated outside the VSCode extension host. Faithful to the product
// flow: background only attaches via scene frontmatter.location (the source has none, so none here).
const workspace = process.env.SCENE_WS ?? process.env.GUERRILA_WS ?? "/Users/maroomir/Git/maroomir/guerrila"
const sceneFileName = process.env.SCENE_FILE ?? process.env.GUERRILA_SCENE ?? "01-first-meeting.txt"

// NOTE: run the G-3 revise loop after generation unless SCENE_REVISE=0; iterations bound CLI cost.
const harnessRunRevise = (process.env.SCENE_REVISE ?? process.env.GUERRILA_REVISE) !== "0"
const harnessReviseIterations = Number(process.env.SCENE_REVISE_ITERS ?? process.env.GUERRILA_REVISE_ITERS ?? "2")

// NOTE: mirror the extension's storyboard.draft.keepHistory — archive the prior draft under
// .draft/<scene>/<yyyy-mm-dd-hh-mm>-rev-NN.md before the headless run overwrites it. On unless
// SCENE_KEEP_HISTORY=0, since each headless regeneration otherwise discards the previous draft.
const harnessKeepHistory = (process.env.SCENE_KEEP_HISTORY ?? process.env.GUERRILA_KEEP_HISTORY) !== "0"

const personaMemoryDirectory = path.join(workspace, ".storyboard", "cache", "personas")
const backgroundMemoryDirectory = path.join(workspace, ".storyboard", "cache", "backgrounds")

const fileSystem = {
  readFile: async (uri: unknown): Promise<Uint8Array> => new Uint8Array(await nodeFs.readFile(uri as string)),
  writeFile: async (uri: unknown, content: Uint8Array): Promise<void> => {
    await nodeFs.writeFile(uri as string, content)
  },
  readDirectory: async (uri: unknown): Promise<[string, { type: "file" | "directory" }][]> => {
    const entries = await nodeFs.readdir(uri as string, { withFileTypes: true })
    return entries.map((entry) => [entry.name, { type: entry.isDirectory() ? "directory" : "file" }])
  }
}

const draftHistoryFs = {
  readFile: fileSystem.readFile,
  writeFile: fileSystem.writeFile,
  exists: async (uri: unknown): Promise<boolean> => {
    try {
      await nodeFs.stat(uri as string)
      return true
    } catch {
      return false
    }
  },
  createDirectory: async (uri: unknown): Promise<void> => {
    await nodeFs.mkdir(uri as string, { recursive: true })
  },
  listFileNames: async (uri: unknown): Promise<string[]> => {
    const entries = await nodeFs.readdir(uri as string, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  }
}

const paths = {
  characterDirectory: path.join(workspace, "character"),
  backgroundDirectory: path.join(workspace, "background"),
  draftDirectory: path.join(workspace, "draft"),
  bibleCanon: path.join(workspace, ".storyboard", "bible", "canon.yaml"),
  manuscriptSummary: undefined,
  joinPath: (base: unknown, ...segments: string[]): string => path.join(base as string, ...segments)
}

function isUsageLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /usage limit|Upgrade to Pro|rate limit|quota|too many requests/i.test(message)
}

// NOTE: harness-only — when codex hits its usage limit mid-run, switch the remaining beats to
// claude-code so verification can finish instead of aborting. Mixed-model output is acceptable here.
class FallbackCliProvider implements AiProvider {
  public readonly id: AiProviderId
  public readonly displayName = "harness-fallback"
  private fellBack = false

  public constructor(
    private readonly primary: AiProvider,
    private readonly fallback: AiProvider
  ) {
    this.id = primary.id
  }

  public checkConnection(): Promise<boolean> {
    return this.primary.checkConnection()
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    if (this.fellBack) {
      return this.fallback.generate(request)
    }

    try {
      return await this.primary.generate(request)
    } catch (error) {
      if (!isUsageLimitError(error)) {
        throw error
      }
      this.fellBack = true
      // eslint-disable-next-line no-console
      console.log("[harness] codex usage limit hit — falling back to claude-code for remaining calls")
      return this.fallback.generate(request)
    }
  }
}

function createCliProvider(): AiProvider {
  const baseRunner = createDefaultCliRunner()
  const createRunner = (): typeof baseRunner => (input): Promise<CliRunResult> =>
    baseRunner({ ...input, timeoutMs: harnessCliTimeoutMs })

  const claude = new ClaudeCodeProvider({ command: "claude", model: "claude-sonnet-4-6", createRunner })

  if (harnessProviderId === "claude-code") {
    return claude
  }

  const codex = new CodexProvider({
    command: harnessCommand,
    model: harnessModel,
    reasoningEffort: harnessReasoningEffort,
    createRunner
  })
  return new FallbackCliProvider(codex, claude)
}

function createRegistry(): AiProviderRegistry {
  const provider = createCliProvider()
  const registry = {
    generate: (request: unknown): Promise<AiGenerateResponse> => provider.generate(request as never),
    generateWithProvider: (_providerId: unknown, request: unknown): Promise<AiGenerateResponse> =>
      provider.generate(request as never),
    getTaskProvider: (): string => harnessProviderId,
    getTaskAiConfig: (): { readonly providerId: string; readonly model: string } => ({
      providerId: harnessProviderId,
      model: harnessModel
    })
  }

  return registry as unknown as AiProviderRegistry
}

// NOTE: G-2/G-4 — mirror createPersonaMemoryStore/createBackgroundMemoryStore (which require vscode)
// with the harness nodeFs adapter so card-scoped memory is exercised headlessly.
function createHarnessPersonaStore(sceneStem: string): PersonaMemoryStore {
  return {
    async load(card: CharacterCard): Promise<string | undefined> {
      try {
        const record = await readPersonaMemoryFile(path.join(personaMemoryDirectory, `${card.id}.json`), fileSystem)
        return record.cardHash === computePersonaCardHash(card) ? record.persona : undefined
      } catch {
        return undefined
      }
    },
    async save(card: CharacterCard, persona: string): Promise<void> {
      await nodeFs.mkdir(personaMemoryDirectory, { recursive: true })
      await writePersonaMemoryFile(path.join(personaMemoryDirectory, `${card.id}.json`), fileSystem, {
        cardId: card.id,
        persona,
        updatedThroughScene: sceneStem,
        cardHash: computePersonaCardHash(card)
      })
    }
  }
}

function createHarnessBackgroundStore(sceneStem: string): BackgroundMemoryStore {
  return {
    async load(card: BackgroundCard): Promise<string | undefined> {
      try {
        const record = await readBackgroundMemoryFile(path.join(backgroundMemoryDirectory, `${card.id}.json`), fileSystem)
        return record.cardHash === computeBackgroundCardHash(card) ? record.atmosphere : undefined
      } catch {
        return undefined
      }
    },
    async save(card: BackgroundCard, atmosphere: string): Promise<void> {
      await nodeFs.mkdir(backgroundMemoryDirectory, { recursive: true })
      await writeBackgroundMemoryFile(path.join(backgroundMemoryDirectory, `${card.id}.json`), fileSystem, {
        cardId: card.id,
        atmosphere,
        updatedThroughScene: sceneStem,
        cardHash: computeBackgroundCardHash(card)
      })
    }
  }
}

interface HarnessReviseInput {
  readonly aiService: StoryboardAIService
  readonly providerId: AiProviderId
  readonly context: SceneContext
  readonly intent: string
  readonly factLines: readonly string[]
  readonly styleDirective: ReturnType<typeof buildStyleDirective>
  readonly styleConstraints: readonly string[]
  readonly qualityCriteria: readonly string[]
  readonly format: ProjectFormat
  readonly initialBody: string
  readonly sceneStem: string
}

// NOTE: headless mirror of runReviseDraftWorkflow (which imports vscode). Exercises the G-3 routing
// path: continuity+critique → routeReviewIssues → per-agent scoped reviseDraft passes.
async function runHarnessReviseLoop(input: HarnessReviseInput): Promise<{
  body: string
  passed: boolean
  revisionCount: number
  remainingBlocking: number
}> {
  const attribution = { primary: { kind: "scene" as const, id: input.sceneStem } }
  const characterNames = input.context.characters.map((character) => character.name)
  const cardNameById = new Map(input.context.characters.map((character) => [character.id, character.name] as const))

  let body = input.initialBody
  let revisionCount = 0
  let blocking = 0
  let passed = false

  for (;;) {
    const [continuityIssues, critiqueIssues] = await Promise.all([
      input.aiService.checkContinuity(body, input.factLines, { providerId: input.providerId, attribution }),
      input.aiService.critiqueDraft(
        {
          body,
          intent: input.intent,
          characters: characterNames,
          facts: input.factLines,
          styleConstraints: input.styleConstraints,
          qualityCriteria: input.qualityCriteria,
          styleDirective: input.styleDirective
        },
        { providerId: input.providerId, attribution }
      )
    ])

    blocking = countBlockingIssues(continuityIssues, critiqueIssues)
    const score = scoreCritique(critiqueIssues)
    const highContinuityCount = continuityIssues.filter((issue) => issue.severity === "high").length

    // eslint-disable-next-line no-console
    console.log(
      `[revise ${revisionCount}/${harnessReviseIterations}] blocking=${blocking} score=${score.overall} continuityHigh=${highContinuityCount}`
    )

    if (shouldPassRevise({ blocking, score: score.overall, threshold: 0, highContinuityCount })) {
      passed = true
      break
    }

    if (revisionCount >= harnessReviseIterations) {
      break
    }

    const reviewIssues = [
      ...adaptContinuityIssues(continuityIssues),
      ...adaptCritiqueIssues(critiqueIssues, input.context.characters)
    ]
    const routing = routeReviewIssues(reviewIssues)
    const globalInstructions = buildRevisionInstructions(continuityIssues, critiqueIssues)

    const revisionPasses =
      routing.groups.length > 0
        ? [
            ...routing.groups.map((group) => buildScopedInstructions(group, (cardId) => cardNameById.get(cardId))),
            ...(routing.global.length > 0 ? [globalInstructions] : [])
          ]
        : [globalInstructions]

    // eslint-disable-next-line no-console
    console.log(`[revise ${revisionCount}] groups=${routing.groups.length} global=${routing.global.length}`)

    for (const instructions of revisionPasses) {
      body = await input.aiService.reviseDraft(
        { body, format: input.format, instructions, intent: input.intent, facts: input.factLines },
        { providerId: input.providerId, attribution }
      )
    }

    revisionCount += 1
  }

  return { body, passed, revisionCount, remainingBlocking: blocking }
}

test("regenerate guerrila draft via codex pipeline", async () => {
  const scene = await readSceneFile(path.join(workspace, "scene", sceneFileName), fileSystem, sceneFileName)
  const project = JSON.parse(await nodeFs.readFile(path.join(workspace, ".storyboard", "project.json"), "utf8"))

  const context: SceneContext = await buildSceneContext(paths, scene, fileSystem)
  // eslint-disable-next-line no-console
  console.log("detected characters:", context.characters.map((character) => character.name).join(", "))

  // NOTE: 배경 카드가 스키마 검증에 실패하면 조용히 탈락해 frontmatter.location이 무시된다.
  // 헤드리스 사용자가 미부착을 즉시 알 수 있도록 부착 결과를 로그로 남긴다.
  if (context.background) {
    // eslint-disable-next-line no-console
    console.log(`detected background: ${context.background.name}`)
  } else if (scene.frontmatter.location) {
    // eslint-disable-next-line no-console
    console.warn(
      `[harness] frontmatter.location='${scene.frontmatter.location}'에 해당하는 배경 카드를 찾지 못했습니다. background/*.card의 id와 스키마(locationKind: place|affiliation 등)를 확인하세요.`
    )
  }

  const narrative = await buildNarrativeContext(paths, context, fileSystem)
  const styleDirective = buildStyleDirective(
    project.setting,
    scene.frontmatter.relationStage,
    scene.frontmatter.targetWordCount
  )
  const aiService = new StoryboardAIService(createRegistry())

  const result = await runSceneGenerationPipeline({
    sceneStem: scene.stem,
    context,
    aiService,
    format: project.format,
    styleDirective,
    previousContext: narrative.prompt,
    providers: {
      situationExtraction: harnessProviderId,
      personaGeneration: harnessProviderId,
      personaDialogue: harnessProviderId,
      sceneDraft: harnessProviderId
    },
    personaStore: createHarnessPersonaStore(scene.stem),
    backgroundStore: createHarnessBackgroundStore(scene.stem),
    onProgress: (stage, current, total) => {
      // eslint-disable-next-line no-console
      console.log(`[${stage}] ${current}/${total}`)
    },
    useContextCondense: false
  })

  // eslint-disable-next-line no-console
  console.log(`situations=${result.situations.length} characters=${result.detectedCharacters.join(", ")}`)

  const draftPath = path.join(workspace, "draft", `${scene.stem}.md`)

  if (harnessKeepHistory) {
    const historyDirectory = path.join(workspace, ".draft", scene.stem)
    const archivedFileName = await archiveExistingDraft({
      draftUri: draftPath,
      historyDirectory,
      resolveArchiveUri: (fileName) => path.join(historyDirectory, fileName),
      fileSystem: draftHistoryFs
    })

    if (archivedFileName) {
      // eslint-disable-next-line no-console
      console.log(`[harness] archived previous draft → .draft/${scene.stem}/${archivedFileName}`)
    }
  }

  let body = result.draftBody
  await nodeFs.writeFile(
    draftPath,
    serializeDraft(createDraft({ sceneStem: scene.stem, format: project.format, body })),
    "utf8"
  )

  if (harnessRunRevise) {
    const revision = await runHarnessReviseLoop({
      aiService,
      providerId: harnessProviderId,
      context,
      intent: scene.body,
      factLines: formatBibleFactLines(context, narrative.bibleFacts),
      styleDirective,
      styleConstraints: project.setting?.styleConstraints ?? [],
      qualityCriteria: project.setting?.qualityCriteria ?? [],
      format: project.format,
      initialBody: body,
      sceneStem: scene.stem
    })

    body = revision.body
    await nodeFs.writeFile(
      draftPath,
      serializeDraft(createDraft({ sceneStem: scene.stem, format: project.format, body })),
      "utf8"
    )

    // eslint-disable-next-line no-console
    console.log(
      `[revise done] passed=${revision.passed} revisions=${revision.revisionCount} remainingBlocking=${revision.remainingBlocking}`
    )
  }
}, 7_200_000)
