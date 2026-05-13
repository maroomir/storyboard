import { ZodError } from "zod"
import { z } from "zod"

import { UNSUPPORTED_LEGACY_SEED_FILE_MESSAGE } from "@/constants/projectStorageMessages"
import { storyboardProjectSchema } from "@/files/projectJson"
import {
  backgroundCardSchema,
  characterCardSchema,
  type BackgroundCard,
  type CharacterCard
} from "@/shared/card"
import { parseSceneStem } from "@/shared/scene"
import type { StoryboardProject } from "@/shared/project"

export const SEED_ENVELOPE_VERSION = "2.0.0" as const

export { characterCardSchema, backgroundCardSchema } from "@/shared/card"
export { storyboardProjectSchema as projectJsonSchema } from "@/files/projectJson"

export const seedProjectSchema = storyboardProjectSchema.extend({
  settings: z.object({
    scenePrefixDigits: z.number().int().positive(),
    trackDraft: z.boolean().optional()
  })
})

export const sceneEnvelopeEntrySchema = z
  .object({
    stem: z.string(),
    content: z.string()
  })
  .superRefine((entry, ctx) => {
    if (parseSceneStem(entry.stem) === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stem은 scene stem 패턴(NN-slug)을 만족해야 합니다.",
        path: ["stem"]
      })
    }
  })

export const seedEnvelopeSchema = z.object({
  version: z.literal(SEED_ENVELOPE_VERSION),
  project: seedProjectSchema,
  characters: z.array(characterCardSchema),
  backgrounds: z.array(backgroundCardSchema),
  scenes: z.array(sceneEnvelopeEntrySchema)
})

export type SeedEnvelopeSceneEntry = z.infer<typeof sceneEnvelopeEntrySchema>

export interface ParsedSeedEnvelope {
  readonly version: typeof SEED_ENVELOPE_VERSION
  readonly project: StoryboardProject
  readonly characters: readonly CharacterCard[]
  readonly backgrounds: readonly BackgroundCard[]
  readonly scenes: readonly SeedEnvelopeSceneEntry[]
}

export type SeedParseErrorCode =
  | "invalid-json"
  | "legacy-envelope"
  | "unsupported-envelope-version"
  | "schema-validation"

export class SeedParseError extends Error {
  public constructor(
    public readonly code: SeedParseErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = "SeedParseError"
  }
}

export function normalizeSeedProjectToDisk(
  project: z.infer<typeof seedProjectSchema>
): StoryboardProject {
  return storyboardProjectSchema.parse({
    ...project,
    settings: {
      scenePrefixDigits: project.settings.scenePrefixDigits,
      trackDraft: project.settings.trackDraft ?? false
    }
  })
}

export function parseSeed(raw: string): ParsedSeedEnvelope {
  let json: unknown

  try {
    json = JSON.parse(raw) as unknown
  } catch (error) {
    throw new SeedParseError("invalid-json", "Seed 파일이 올바른 JSON이 아닙니다.", error)
  }

  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new SeedParseError("schema-validation", "Seed 파일의 최상위 값은 객체여야 합니다.")
  }

  const record = json as Record<string, unknown>
  const version = record.version

  if (version === "1.2.0") {
    throw new SeedParseError("legacy-envelope", UNSUPPORTED_LEGACY_SEED_FILE_MESSAGE)
  }

  if (version !== SEED_ENVELOPE_VERSION) {
    throw new SeedParseError(
      "unsupported-envelope-version",
      `지원하는 Seeds envelope 버전은 "${SEED_ENVELOPE_VERSION}"만 가능합니다.`
    )
  }

  try {
    const parsed = seedEnvelopeSchema.parse(json)
    return {
      version: parsed.version,
      project: normalizeSeedProjectToDisk(parsed.project),
      characters: parsed.characters,
      backgrounds: parsed.backgrounds,
      scenes: parsed.scenes
    }
  } catch (error) {
    if (error instanceof ZodError) {
      throw new SeedParseError(
        "schema-validation",
        "Seed envelope 내용이 스키마와 맞지 않습니다.",
        error
      )
    }

    throw error
  }
}

export function serializeSeed(envelope: ParsedSeedEnvelope): string {
  const payload = {
    version: SEED_ENVELOPE_VERSION,
    project: envelope.project,
    characters: [...envelope.characters],
    backgrounds: [...envelope.backgrounds],
    scenes: [...envelope.scenes]
  }

  return `${JSON.stringify(payload, null, 2)}\n`
}
