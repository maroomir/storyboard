import nodeFs from "node:fs/promises"
import path from "node:path"

import { test } from "vitest"

import { buildSceneContext } from "@/domain/sceneContext"
import { readSceneFile } from "@/domain/files/scene"
import { StoryboardAIService } from "@/infrastructure/ai/AIService"
import type { AiProviderRegistry } from "@/infrastructure/ai/providerRegistry"
import { ClaudeCodeProvider } from "@/infrastructure/ai/providers/ClaudeCodeProvider"
import { CodexProvider } from "@/infrastructure/ai/providers/CodexProvider"
import { createDefaultCliRunner, type CliRunResult } from "@/infrastructure/ai/providers/cliRunner"
import type { AiGenerateResponse, AiProvider } from "@/shared/aiTypes"
import { summarizeSceneCoverage } from "@/shared/sceneCoverage"

// NOTE: Diagnostic — runs the new checkSceneCoverage feature against the current draft to verify
// every source beat is dramatized in order. Re-extracts beats so it does not depend on stale cache.
const workspace = process.env.SCENE_WS ?? process.env.GUERRILA_WS ?? "/Users/maroomir/Git/maroomir/guerrila"
const sceneFileName = process.env.SCENE_FILE ?? process.env.GUERRILA_SCENE ?? "01-first-meeting.txt"
const providerId = process.env.SCENE_PROVIDER ?? process.env.GUERRILA_PROVIDER ?? "codex"
const model =
  process.env.SCENE_MODEL ?? process.env.GUERRILA_MODEL ?? (providerId === "claude-code" ? "claude-sonnet-4-6" : "gpt-5.5")

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
  manuscriptSummary: undefined,
  joinPath: (base: unknown, ...segments: string[]): string => path.join(base as string, ...segments)
}

function createRegistry(): AiProviderRegistry {
  const baseRunner = createDefaultCliRunner()
  const createRunner = (): typeof baseRunner => (input): Promise<CliRunResult> =>
    baseRunner({ ...input, timeoutMs: 600_000 })
  const provider: AiProvider =
    providerId === "claude-code"
      ? new ClaudeCodeProvider({ command: "claude", model, createRunner })
      : new CodexProvider({ command: "codex", model, createRunner })
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
  const aiService = new StoryboardAIService(createRegistry())

  // eslint-disable-next-line no-console
  console.log("characters:", context.characters.map((character) => character.name).join(", "))
  const situations = await aiService.extractSituations(scene.body, { providerId: providerId as never })
  const beats = situations.map((situation) => situation.situation)

  const draftPath = path.join(workspace, "draft", `${scene.stem}.md`)
  const draft = await nodeFs.readFile(draftPath, "utf8")

  const issues = await aiService.checkSceneCoverage(beats, draft, { providerId: providerId as never })
  const report = summarizeSceneCoverage(issues, beats.length)

  // eslint-disable-next-line no-console
  console.log(`COVERAGE total=${report.totalBeats} missing=[${report.missing.join(",")}] outOfOrder=[${report.outOfOrder.join(",")}] coveredRatio=${report.coveredRatio.toFixed(3)}`)
  issues.forEach((issue) => {
    // eslint-disable-next-line no-console
    console.log(`#${issue.index} ${issue.status} — ${issue.note ?? ""} :: ${beats[issue.index - 1] ?? ""}`)
  })
}, 600_000)
