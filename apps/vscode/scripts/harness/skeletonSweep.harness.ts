import nodeFs from "node:fs/promises"
import path from "node:path"

import { afterAll, test } from "vitest"

import { NodeUri, buildSceneContext, joinStoryPath, readSceneFile } from "@storyboard/story-format"
import type { ProjectFormat, ProjectSetting, StoryUri } from "@storyboard/story-format"
import { StoryboardAiService, buildStyleDirective } from "@storyboard/story-ai"
import type { AiGenerateResponse, AiProvider, AiProviderRegistry } from "@storyboard/story-ai"
import { SceneGenerationPipeline } from "@storyboard/story-pipeline"

import { createUsageSummary } from "./usageSummary"
import { createHarnessProvider, defaultHarnessModel, resolveHarnessProviderId } from "./harnessProvider"

// NOTE: 진단 — 뼈대 비율과 살붙임 구간 상한을 조건별로 흔들어 목표 분량 대비 실제 초안 분량(도달률)을
// 잰다. 파이프라인을 직접 세우므로 ConfigBridge·모델 프로필을 거치지 않는다. 서술자·이전 씬 맥락·
// 캐넌은 조건 간 비교를 위해 넣지 않으므로, 절대 도달률은 실사용 값과 다를 수 있다.
const workspace = process.env.SWEEP_WS ?? `${process.env.HOME ?? ""}/Git/webfic/level-zero`
const sceneFileName = process.env.SWEEP_SCENE ?? "10-scene-3-2.card"
const providerId = resolveHarnessProviderId(process.env.SWEEP_PROVIDER ?? "claude-code")
const model = process.env.SWEEP_MODEL ?? defaultHarnessModel(providerId)
const runsPerCondition = Number(process.env.SWEEP_RUNS ?? "2")
const runTimeoutMs = Number(process.env.SWEEP_TIMEOUT_MS ?? String(60 * 60 * 1000))
const resultFile =
  process.env.SWEEP_OUT ?? path.join(workspace, ".storyboard", "cache", "skeleton-sweep.json")

const skeletonRatios = (process.env.SWEEP_SKELETON_RATIOS ?? "0.33,0.45,0.55")
  .split(",")
  .map((value) => Number(value.trim()))
const sectionOutputLimits = (process.env.SWEEP_SECTION_LIMITS ?? "7000,1000")
  .split(",")
  .map((value) => Number(value.trim()))

interface SweepRow {
  readonly skeletonRatio: number
  readonly sectionOutputLimit: number
  readonly run: number
  readonly targetLength: number
  readonly skeletonLength: number
  readonly draftLength: number
  readonly reach: number
  readonly expansionRatio: number
  readonly warnings: readonly string[]
}

const rows: SweepRow[] = []

// NOTE: 씬 카드는 옆의 `*.summary.md` 를 형제 경로로 찾으므로 문자열 경로로는 읽히지 않는다.
// CLI 가 쓰는 NodeUri 를 그대로 써서 두 앱과 같은 경로 규칙을 따른다.
const workspaceUri = NodeUri.file(workspace)

const fileSystem = {
  readFile: async (uri: unknown): Promise<Uint8Array> =>
    new Uint8Array(await nodeFs.readFile((uri as StoryUri).fsPath)),
  writeFile: async (uri: unknown, content: Uint8Array): Promise<void> => {
    await nodeFs.writeFile((uri as StoryUri).fsPath, content)
  },
  readDirectory: async (uri: unknown): Promise<[string, { type: "file" | "directory" }][]> => {
    const entries = await nodeFs.readdir((uri as StoryUri).fsPath, { withFileTypes: true })
    return entries.map((entry) => [entry.name, { type: entry.isDirectory() ? "directory" : "file" }])
  }
}

const paths = {
  characterDirectory: joinStoryPath(workspaceUri, "character"),
  backgroundDirectory: joinStoryPath(workspaceUri, "background"),
  draftDirectory: joinStoryPath(workspaceUri, "draft"),
  bibleCanon: joinStoryPath(workspaceUri, ".storyboard", "bible", "canon.yaml"),
  chapterSummaries: undefined,
  joinPath: (base: unknown, ...segments: string[]): StoryUri =>
    joinStoryPath(base as StoryUri, ...segments)
}

function createRegistry(provider: AiProvider): AiProviderRegistry {
  const registry = {
    generate: (request: unknown): Promise<AiGenerateResponse> => provider.generate(request as never),
    generateWithProvider: (_id: unknown, request: unknown): Promise<AiGenerateResponse> =>
      provider.generate(request as never),
    getTaskProvider: (): string => providerId,
    getTaskAiConfig: (): { readonly providerId: string; readonly model: string } => ({ providerId, model })
  }
  return registry as unknown as AiProviderRegistry
}

interface ProjectFile {
  readonly format: ProjectFormat
  readonly setting?: ProjectSetting
}

async function readProjectFile(): Promise<ProjectFile> {
  const raw = await nodeFs.readFile(path.join(workspace, ".storyboard", "project.json"), "utf8")
  return JSON.parse(raw) as ProjectFile
}

for (const skeletonRatio of skeletonRatios) {
  for (const sectionOutputLimit of sectionOutputLimits) {
    for (let run = 1; run <= runsPerCondition; run += 1) {
      const label = `skeletonRatio=${skeletonRatio} sectionOutputLimit=${sectionOutputLimit} run=${run}`

      test(
        `sweep ${label}`,
        async () => {
          const project = await readProjectFile()
          const scene = await readSceneFile(
            joinStoryPath(workspaceUri, "scene", sceneFileName),
            fileSystem,
            sceneFileName
          )
          const context = await buildSceneContext(paths, scene, fileSystem)
          const usage = createUsageSummary()
          const provider = await createHarnessProvider(providerId, model)
          const aiService = new StoryboardAiService(createRegistry(provider), { onUsage: usage.onUsage })
          const styleDirective = buildStyleDirective(
            project.setting,
            scene.frontmatter.relationStage,
            scene.frontmatter.targetWordCount,
            scene.body
          )
          const targetLength = styleDirective?.targetWordCount ?? 0

          try {
            const result = await new SceneGenerationPipeline({
              sceneStem: scene.stem,
              context,
              aiService,
              format: project.format,
              styleDirective,
              sectionOutputLimit,
              tuning: { skeletonRatio }
            }).run()

            const row: SweepRow = {
              skeletonRatio,
              sectionOutputLimit,
              run,
              targetLength,
              skeletonLength: result.skeleton.length,
              draftLength: result.draftBody.length,
              reach: targetLength === 0 ? 0 : result.draftBody.length / targetLength,
              expansionRatio:
                result.skeleton.length === 0 ? 0 : result.draftBody.length / result.skeleton.length,
              warnings: result.warnings
            }
            rows.push(row)

            // eslint-disable-next-line no-console
            console.log(
              `SWEEP ${label} target=${row.targetLength} skeleton=${row.skeletonLength} draft=${row.draftLength} reach=${row.reach.toFixed(3)} expansion=${row.expansionRatio.toFixed(2)} warnings=${row.warnings.length}`
            )
            // 도달률이 낮을 때 원인은 대개 재시도로도 못 고친 위반이다. 숫자만으로는 못 읽는다.
            for (const warning of row.warnings) {
              // eslint-disable-next-line no-console
              console.log(`  ! ${warning}`)
            }
          } finally {
            usage.print()
          }
        },
        runTimeoutMs
      )
    }
  }
}

afterAll(async () => {
  if (rows.length === 0) {
    return
  }

  await nodeFs.mkdir(path.dirname(resultFile), { recursive: true })
  await nodeFs.writeFile(
    resultFile,
    // NOTE: 구독 CLI 로 잰 값은 API 모델과 같다는 보증이 없어 모델 프로필에 기록하지 않는다.
    JSON.stringify({ workspace, sceneFileName, providerId, model, profileEligible: providerId !== "claude-code", rows }, null, 2),
    "utf8"
  )

  // eslint-disable-next-line no-console
  console.log(`\n[sweep] ${rows.length} runs -> ${resultFile}`)
  for (const row of rows) {
    // eslint-disable-next-line no-console
    console.log(
      `[sweep] ratio=${row.skeletonRatio} limit=${row.sectionOutputLimit} run=${row.run} reach=${row.reach.toFixed(3)}`
    )
  }
})
