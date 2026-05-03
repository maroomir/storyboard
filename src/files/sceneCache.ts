import { createHash } from "node:crypto"
import { z } from "zod"

import type { BackgroundCard, CharacterCard } from "../shared/card"
import type { ProjectFormat } from "../shared/project"
import { aiProviderIds, type AiProviderId, type AiTaskName } from "../services/ai/types"

export interface SceneCacheSituation {
  readonly summary: string
  readonly characters: readonly string[]
}

export interface SceneCacheBackgroundSnapshot {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly country?: string
  readonly category?: string
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
}

const sceneCacheSituationSchema = z.object({
  summary: z.string(),
  characters: z.array(z.string())
})

const sceneCacheBackgroundSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  country: z.string().optional(),
  category: z.string().optional()
})

const aiProviderIdSchema = z.enum(aiProviderIds)
const sceneCacheProvidersSchema = z.object({
  situationExtraction: aiProviderIdSchema.optional(),
  personaDialogue: aiProviderIdSchema.optional(),
  sceneDraft: aiProviderIdSchema.optional(),
  grammarCheck: aiProviderIdSchema.optional(),
  inlineCompletion: aiProviderIdSchema.optional(),
  draftExpansion: aiProviderIdSchema.optional()
})

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
          id: input.background.id,
          name: input.background.name,
          country: input.background.country,
          category: input.background.category,
          tags: input.background.tags ?? [],
          description: input.background.description ?? ""
        }
      : undefined,
    format: input.format
  }
  const hash = createHash("sha256").update(JSON.stringify(digestSource)).digest("hex")

  return `sha256:${hash}`
}
