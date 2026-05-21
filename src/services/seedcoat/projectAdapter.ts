import { ZodError } from "zod"

import { storyboardProjectVersion } from "@/shared/project"
import type { StoryboardProject } from "@/shared/project"
import {
  backgroundCardSchema,
  characterCardSchema,
  type BackgroundCard,
  type CharacterCard
} from "@/shared/card"
import { storyboardProjectSchema } from "@/files/projectJson"
import { SEED_PASSPHRASE_REQUIRED_MESSAGE } from "@/constants/projectStorageMessages"
import { decode, encode, validate, type SeedParts } from "@/services/seedcoat/loader"

function assertPassphraseProvided(passphrase: string): void {
  if (passphrase.length === 0) {
    throw new Error(SEED_PASSPHRASE_REQUIRED_MESSAGE)
  }
}

export interface SeedSceneEntry {
  readonly stem: string
  readonly content: string
}

export interface DecodedSeedContent {
  readonly project: StoryboardProject
  readonly characters: readonly CharacterCard[]
  readonly backgrounds: readonly BackgroundCard[]
  readonly scenes: readonly SeedSceneEntry[]
}

export interface WorkspaceContent {
  readonly project: StoryboardProject
  readonly characters: readonly CharacterCard[]
  readonly backgrounds: readonly BackgroundCard[]
  readonly scenes: readonly SeedSceneEntry[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseJsonPart(label: string, json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    throw new Error(`${label}: JSON 파싱에 실패했습니다.`)
  }
}

function parseProjectPart(value: unknown): StoryboardProject {
  if (!isPlainObject(value)) {
    throw new Error("project: JSON 파싱에 실패했습니다.")
  }
  if (value.version !== storyboardProjectVersion) {
    throw new Error(`지원하지 않는 project 버전: ${String(value.version)}`)
  }
  try {
    return storyboardProjectSchema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`project: 스키마 검증에 실패했습니다.`)
    }
    throw error
  }
}

function parseCharacterArray(value: unknown): CharacterCard[] {
  if (!Array.isArray(value)) {
    throw new Error("characters: JSON 파싱에 실패했습니다.")
  }
  return value.map((item, i) => {
    try {
      return characterCardSchema.parse(item)
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`characters[${i}]: 스키마 검증에 실패했습니다.`)
      }
      throw error
    }
  })
}

function parseBackgroundArray(value: unknown): BackgroundCard[] {
  if (!Array.isArray(value)) {
    throw new Error("backgrounds: JSON 파싱에 실패했습니다.")
  }
  return value.map((item, i) => {
    try {
      return backgroundCardSchema.parse(item)
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`backgrounds[${i}]: 스키마 검증에 실패했습니다.`)
      }
      throw error
    }
  })
}

function parseSceneEntries(value: unknown): SeedSceneEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("scenes: JSON 파싱에 실패했습니다.")
  }
  return value.map((item) => {
    if (!isPlainObject(item) || typeof item.stem !== "string" || typeof item.content !== "string") {
      throw new Error("scenes: 각 항목은 stem과 content 문자열 필드를 가져야 합니다.")
    }
    return { stem: item.stem, content: item.content }
  })
}

export async function decodeSeedToWritePlan(
  bytes: Uint8Array,
  passphrase: string
): Promise<DecodedSeedContent> {
  assertPassphraseProvided(passphrase)
  const parts = await decode(bytes, passphrase)

  const project = parseProjectPart(parseJsonPart("project", parts.project))
  const characters = parseCharacterArray(parseJsonPart("characters", parts.characters))
  const backgrounds = parseBackgroundArray(parseJsonPart("backgrounds", parts.backgrounds))
  const scenes = parseSceneEntries(parseJsonPart("scenes", parts.scenes))

  const parsedCharIds = new Set(characters.map((c) => c.id))

  return {
    project,
    characters,
    backgrounds: backgrounds.map((bg) => ({
      ...bg,
      characterIds: bg.characterIds.filter((id) => parsedCharIds.has(id))
    })),
    scenes
  }
}

export async function encodeWorkspaceToSeed(
  content: WorkspaceContent,
  passphrase: string
): Promise<Uint8Array> {
  assertPassphraseProvided(passphrase)
  const projectEnvelope = {
    version: content.project.version,
    id: content.project.id,
    name: content.project.name,
    format: content.project.format,
    language: content.project.language,
    createdAt: content.project.createdAt,
    editor: { scenePrefixDigits: content.project.editor.scenePrefixDigits },
    setting: content.project.setting
  }

  const characters = content.characters.map((c) => ({
    type: c.type,
    id: c.id,
    name: c.name,
    role: c.role ?? "",
    ...(c.tags !== undefined ? { tags: c.tags } : {}),
    traits: c.traits ?? [],
    description: c.description ?? "",
    relations: c.relations ?? [],
    arc: c.arc ?? [],
    recentDialogues: c.recentDialogues ?? [],
    ...(c.profile !== undefined ? { profile: c.profile } : {}),
    ...(c.attributes !== undefined ? { attributes: c.attributes } : {})
  }))

  const sortedScenes = [...content.scenes].sort((a, b) => a.stem.localeCompare(b.stem))

  const parts: SeedParts = {
    project: JSON.stringify(projectEnvelope),
    characters: JSON.stringify(characters),
    backgrounds: JSON.stringify(content.backgrounds),
    scenes: JSON.stringify(sortedScenes)
  }

  await validate(parts)
  return encode(parts, passphrase, { kdfProfile: "interactive" })
}
