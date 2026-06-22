import nodeFs from "node:fs/promises"
import path from "node:path"

import { test } from "vitest"

import { buildNarrativeContext, buildSceneContext, type SceneContext } from "@/core/sceneContext"
import { createDraft, serializeDraft } from "@/files/draft"
import { readSceneFile } from "@/files/scene"
import { StoryboardAIService } from "@/services/ai/AIService"
import { runSceneGenerationPipeline } from "@/services/ai/pipelines/sceneGenerationPipeline"
import type { AiProviderRegistry } from "@/services/ai/providerRegistry"
import { ClaudeCodeProvider } from "@/services/ai/providers/ClaudeCodeProvider"
import { CodexProvider } from "@/services/ai/providers/CodexProvider"
import { createDefaultCliRunner, type CliRunResult } from "@/services/ai/providers/cliRunner"
import type { AiGenerateResponse, AiProvider, AiProviderId } from "@/services/ai/types"
import { buildStyleDirective } from "@/shared/styleDirective"

// NOTE: reasoning calls can exceed the provider's 180s default; lengthen only in the harness so a
// single slow beat does not abort a full long-form regeneration.
const harnessCliTimeoutMs = 600_000

// NOTE: codex (gpt-5.5) is the default; on codex usage-limit fall back to claude-code (sonnet) via
// GUERRILA_PROVIDER=claude-code, per the project's provider fallback policy.
const harnessProviderId = (process.env.GUERRILA_PROVIDER ?? "codex") as AiProviderId
const harnessModel =
  process.env.GUERRILA_MODEL ?? (harnessProviderId === "claude-code" ? "claude-sonnet-4-6" : "gpt-5.5")
const harnessCommand = harnessProviderId === "claude-code" ? "claude" : "codex"

// NOTE: Headless harness that drives the REAL scene-generation pipeline against the codex CLI so
// the guerrila draft can be regenerated outside the VSCode extension host. Faithful to the product
// flow: background only attaches via scene frontmatter.location (the source has none, so none here).
const workspace = process.env.GUERRILA_WS ?? "/Users/maroomir/Git/maroomir/guerrila"
const sceneFileName = process.env.GUERRILA_SCENE ?? "01-first-meeting.txt"

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

function createCliProvider(): AiProvider {
  const baseRunner = createDefaultCliRunner()
  const createRunner = (): typeof baseRunner => (input): Promise<CliRunResult> =>
    baseRunner({ ...input, timeoutMs: harnessCliTimeoutMs })

  if (harnessProviderId === "claude-code") {
    return new ClaudeCodeProvider({ command: harnessCommand, model: harnessModel, createRunner })
  }

  return new CodexProvider({ command: harnessCommand, model: harnessModel, createRunner })
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

test("regenerate guerrila draft via codex pipeline", async () => {
  const scene = await readSceneFile(path.join(workspace, "scene", sceneFileName), fileSystem, sceneFileName)
  const project = JSON.parse(await nodeFs.readFile(path.join(workspace, ".storyboard", "project.json"), "utf8"))

  const context: SceneContext = await buildSceneContext(paths, scene, fileSystem)
  // eslint-disable-next-line no-console
  console.log("detected characters:", context.characters.map((character) => character.name).join(", "))

  const narrative = await buildNarrativeContext(paths, context, fileSystem)
  const styleDirective = buildStyleDirective(project.setting, scene.frontmatter.relationStage)
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
    onProgress: (stage, current, total) => {
      // eslint-disable-next-line no-console
      console.log(`[${stage}] ${current}/${total}`)
    },
    useContextCondense: false
  })

  // eslint-disable-next-line no-console
  console.log(`situations=${result.situations.length} characters=${result.detectedCharacters.join(", ")}`)

  const draft = createDraft({ sceneStem: scene.stem, format: project.format, body: result.draftBody })
  await nodeFs.writeFile(path.join(workspace, "draft", `${scene.stem}.md`), serializeDraft(draft), "utf8")
}, 3_600_000)
