import { createHash } from "node:crypto"
import { z } from "zod"

import type { BackgroundCard, CharacterCard } from "../shared/card"
import type { BibleFact } from "../shared/bible"
import type { ProjectFormat } from "../shared/project"
import { aiProviderIds, aiTaskCatalog, type AiProviderId, type AiTaskName } from "../services/ai/types"

export interface SceneCacheSituation {
  readonly summary: string
  readonly characters: readonly string[]
}

export interface SceneCacheBackgroundSnapshot {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface SceneCacheRecord {
  readonly sceneStem: string
  readonly generatedAt: string
  readonly inputHash: string
  readonly input: string
  readonly detectedCharacters: readonly string[]
  readonly extractedSituations: readonly SceneCacheSituation[]
  readonly personasUsed: Readonly<Record<string, string>>
  readonly backgroundSnapshot?: SceneCacheBackgroundSnapshot
  readonly previousContext?: string
  readonly providers: Partial<Record<AiTaskName, AiProviderId>>
}

export interface SceneCacheFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>
}

export interface SceneInputHashInput {
  readonly sceneBody: string
  readonly characters: readonly CharacterCard[]
  readonly background?: BackgroundCard
  readonly format: ProjectFormat
  readonly bibleFacts?: readonly BibleFact[]
}

const sceneCacheSituationSchema = z.object({
  summary: z.string(),
  characters: z.array(z.string())
})

const sceneCacheBackgroundSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional()
})

const aiProviderIdSchema = z.enum(aiProviderIds)
const sceneCacheProvidersSchema = z.object(
  Object.fromEntries(
    aiTaskCatalog.map((task) => [task.name, aiProviderIdSchema.optional()])
  ) as Record<AiTaskName, z.ZodOptional<typeof aiProviderIdSchema>>
)

const sceneCacheRecordSchema = z.object({
  sceneStem: z.string().trim().min(1),
  generatedAt: z.string().datetime(),
  inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  input: z.string(),
  detectedCharacters: z.array(z.string()),
  extractedSituations: z.array(sceneCacheSituationSchema),
  personasUsed: z.record(z.string(), z.string()),
  backgroundSnapshot: sceneCacheBackgroundSnapshotSchema.optional(),
  previousContext: z.string().optional(),
  providers: sceneCacheProvidersSchema
})

export function serializeSceneCache(record: SceneCacheRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

export function parseSceneCache(rawCache: string): SceneCacheRecord {
  return sceneCacheRecordSchema.parse(JSON.parse(rawCache))
}

export async function readSceneCacheFile(
  uri: unknown,
  fileSystem: SceneCacheFileSystem
): Promise<SceneCacheRecord> {
  const bytes = await fileSystem.readFile(uri)
  return parseSceneCache(new TextDecoder().decode(bytes))
}

export async function writeSceneCacheFile(
  uri: unknown,
  fileSystem: SceneCacheFileSystem,
  record: SceneCacheRecord
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeSceneCache(record)))
}

function digestBibleFacts(facts: readonly BibleFact[]): { kind: string; id: string; key: string; value: string }[] {
  return facts
    .map((fact) => ({ kind: fact.subject.kind, id: fact.subject.id, key: fact.key, value: fact.value }))
    .sort((a, b) => `${a.kind}:${a.id}:${a.key}`.localeCompare(`${b.kind}:${b.id}:${b.key}`))
}

export function computeSceneInputHash(input: SceneInputHashInput): string {
  const digestSource = {
    sceneBody: input.sceneBody,
    characters: input.characters.map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role,
      tags: character.tags ?? [],
      traits: character.traits ?? [],
      description: character.description ?? "",
      recentDialogues: character.recentDialogues ?? []
    })),
    background: input.background
      ? {
          type: input.background.type,
          id: input.background.id,
          name: input.background.name,
          tags: input.background.tags ?? [],
          description: input.background.description ?? "",
          characterIds: input.background.characterIds ?? []
        }
      : undefined,
    format: input.format,
    ...(input.bibleFacts && input.bibleFacts.length > 0
      ? { bibleFacts: digestBibleFacts(input.bibleFacts) }
      : {})
  }
  const hash = createHash("sha256").update(JSON.stringify(digestSource)).digest("hex")

  return `sha256:${hash}`
}
