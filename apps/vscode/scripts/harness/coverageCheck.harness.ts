import nodeFs from "node:fs/promises"
import path from "node:path"

import { test } from "vitest"

import { buildSceneContext, readSceneFile } from "@storyboard/story-format"
import { StoryboardAiService } from "@storyboard/story-ai"
import type { AiProviderRegistry } from "@storyboard/story-ai"
import type { AiGenerateResponse, AiProvider } from "@storyboard/story-ai"
import { summarizeSceneCoverage } from "@storyboard/story-ai"

import { createUsageSummary } from "./usageSummary"
import { createHarnessProvider, defaultHarnessModel, resolveHarnessProviderId } from "./harnessProvider"

// NOTE: Diagnostic — runs the new checkSceneCoverage feature against the current draft to verify
// every source beat is dramatized in order. Re-extracts beats so it does not depend on stale cache.
const workspace = process.env.SCENE_WS ?? process.env.GUERRILA_WS
if (workspace === undefined) {
  throw new Error("Set SCENE_WS to the workspace this harness should read.")
}
const sceneFileName = process.env.SCENE_FILE ?? process.env.GUERRILA_SCENE ?? "01-first-meeting.card"
const providerId = resolveHarnessProviderId(process.env.SCENE_PROVIDER ?? process.env.GUERRILA_PROVIDER)
const model = process.env.SCENE_MODEL ?? process.env.GUERRILA_MODEL ?? defaultHarnessModel(providerId)

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

const paths = {
  characterDirectory: path.join(workspace, "character"),
  backgroundDirectory: path.join(workspace, "background"),
  draftDirectory: path.join(workspace, "draft"),
  bibleCanon: path.join(workspace, ".storyboard", "bible", "canon.yaml"),
  chapterSummaries: undefined,
  joinPath: (base: unknown, ...segments: string[]): string => path.join(base as string, ...segments)
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

test("check scene coverage of current draft", async () => {
  const scene = await readSceneFile(path.join(workspace, "scene", sceneFileName), fileSystem, sceneFileName)
  const context = await buildSceneContext(paths, scene, fileSystem)
  const usage = createUsageSummary()
  const provider = await createHarnessProvider(providerId, model)
  const aiService = new StoryboardAiService(createRegistry(provider), { onUsage: usage.onUsage })
  const attribution = { primary: { kind: "scene" as const, id: scene.stem } }

  try {
    // eslint-disable-next-line no-console
    console.log("characters:", context.characters.map((character) => character.name).join(", "))
    const situations = await aiService.extractSituations(scene.body, {
      providerId: providerId as never,
      attribution
    })
    const beats = situations.map((situation) => situation.situation)

    const draftPath = path.join(workspace, "draft", `${scene.stem}.md`)
    const draft = await nodeFs.readFile(draftPath, "utf8")

    const issues = await aiService.checkSceneCoverage(beats, draft, {
      providerId: providerId as never,
      attribution
    })
    const report = summarizeSceneCoverage(issues, beats.length)

    // eslint-disable-next-line no-console
    console.log(`COVERAGE total=${report.totalBeats} missing=[${report.missing.join(",")}] outOfOrder=[${report.outOfOrder.join(",")}] coveredRatio=${report.coveredRatio.toFixed(3)}`)
    issues.forEach((issue) => {
      // eslint-disable-next-line no-console
      console.log(`#${issue.index} ${issue.status} — ${issue.note ?? ""} :: ${beats[issue.index - 1] ?? ""}`)
    })
  } finally {
    usage.print()
  }
}, 600_000)
