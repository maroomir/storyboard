import { ZodError } from "zod"

import { storyboardProjectVersion } from "@/shared/project"
import type { StoryboardProject } from "@/shared/project"
import {
  backgroundCardSchema,
  characterCardSchema,
  joinCardText,
  splitCardTextToList,
  type BackgroundCard,
  type CharacterCard
} from "@/shared/card"
import { storyboardProjectSchema } from "@/files/projectJson"
import { SEED_NO_HISTORY_MESSAGE } from "@/constants/projectStorageMessages"
import {
  checkoutSnapshot,
  init,
  load,
  loadSeedcoat,
  log,
  note,
  save,
  SeedError,
  type SeedBackgroundCard,
  type SeedCharacterCard,
  type SeedState
} from "@seedcoat/wasm"

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

export function isSeedError(error: unknown): error is SeedError {
  return error instanceof SeedError
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function describeZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".")
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message
    })
    .join("; ")
}

function isSeedRelationWithRequiredFields(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false
  }

  return typeof value.target === "string" && value.target.trim().length > 0 && typeof value.type === "string" && value.type.trim().length > 0
}

function normalizeSeedCharacter(item: unknown): unknown {
  if (!isPlainObject(item)) {
    return item
  }

  const normalized = { ...item }

  if (typeof item.role === "string" && item.role.trim().length === 0) {
    delete normalized.role
  }

  if (typeof item.description === "string") {
    normalized.description = splitCardTextToList(item.description)
  }

  if (typeof item.voice === "string") {
    normalized.voice = splitCardTextToList(item.voice)
  }

  if (Array.isArray(item.relations)) {
    normalized.relations = item.relations.filter(isSeedRelationWithRequiredFields)
  }

  return normalized
}

function normalizeSeedBackground(item: unknown): unknown {
  if (!isPlainObject(item)) {
    return item
  }

  const normalized = { ...item }

  if (typeof item.description === "string") {
    normalized.description = splitCardTextToList(item.description)
  }

  return normalized
}

function parseProjectPart(value: unknown): StoryboardProject {
  if (!isPlainObject(value)) {
    throw new Error("project: 데이터 형식이 올바르지 않습니다.")
  }
  if (value.version !== storyboardProjectVersion) {
    throw new Error(`지원하지 않는 project 버전: ${String(value.version)}`)
  }
  try {
    return storyboardProjectSchema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`project: 스키마 검증에 실패했습니다 — ${describeZodIssues(error)}`)
    }
    throw error
  }
}

function parseCharacterArray(value: unknown): CharacterCard[] {
  if (!Array.isArray(value)) {
    throw new Error("characters: 데이터 형식이 올바르지 않습니다.")
  }
  return value.map((item, i) => {
    try {
      return characterCardSchema.parse(normalizeSeedCharacter(item))
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`characters[${i}]: 스키마 검증에 실패했습니다 — ${describeZodIssues(error)}`)
      }
      throw error
    }
  })
}

function parseBackgroundArray(value: unknown): BackgroundCard[] {
  if (!Array.isArray(value)) {
    throw new Error("backgrounds: 데이터 형식이 올바르지 않습니다.")
  }
  return value.map((item, i) => {
    try {
      return backgroundCardSchema.parse(normalizeSeedBackground(item))
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`backgrounds[${i}]: 스키마 검증에 실패했습니다 — ${describeZodIssues(error)}`)
      }
      throw error
    }
  })
}

function parseSceneEntries(value: unknown): SeedSceneEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("scenes: 데이터 형식이 올바르지 않습니다.")
  }
  return value.map((item) => {
    if (!isPlainObject(item) || typeof item.stem !== "string" || typeof item.content !== "string") {
      throw new Error("scenes: 각 항목은 stem과 content 문자열 필드를 가져야 합니다.")
    }
    return { stem: item.stem, content: item.content }
  })
}

export async function decodeSeedToWritePlan(bytes: Uint8Array): Promise<DecodedSeedContent> {
  await loadSeedcoat()

  const repo = load(bytes)
  const latestNote = log(repo)[0]

  if (latestNote === undefined) {
    throw new Error(SEED_NO_HISTORY_MESSAGE)
  }

  const state = checkoutSnapshot(repo, { changeId: latestNote.changeId })

  const project = parseProjectPart(state.project)
  const characters = parseCharacterArray(state.characters)
  const backgrounds = parseBackgroundArray(state.backgrounds)
  const scenes = parseSceneEntries(state.scenes)

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

function toSeedCharacter(card: CharacterCard): SeedCharacterCard {
  return {
    type: "character",
    id: card.id,
    name: card.name,
    ...(card.role !== undefined ? { role: card.role } : {}),
    ...(card.tags !== undefined ? { tags: [...card.tags] } : {}),
    traits: [...(card.traits ?? [])],
    description: joinCardText(card.description),
    relations: (card.relations ?? [])
      .filter(isSeedRelationWithRequiredFields)
      .map((relation) => ({ target: relation.target, type: relation.type }))
  }
}

function toSeedBackground(card: BackgroundCard): SeedBackgroundCard {
  return { ...card, description: joinCardText(card.description) }
}

export async function encodeWorkspaceToSeed(content: WorkspaceContent): Promise<Uint8Array> {
  await loadSeedcoat()

  const project = content.project
  const state: SeedState = {
    project: {
      version: project.version,
      id: project.id,
      name: project.name,
      format: project.format,
      language: project.language,
      createdAt: new Date(project.createdAt).toISOString(),
      editor: { scenePrefixDigits: project.editor.scenePrefixDigits },
      ...(project.setting !== undefined ? { setting: { ...project.setting } } : {})
    },
    characters: content.characters.map(toSeedCharacter),
    backgrounds: content.backgrounds.map(toSeedBackground),
    scenes: [...content.scenes]
      .sort((a, b) => a.stem.localeCompare(b.stem))
      .map((scene) => ({ stem: scene.stem, content: scene.content }))
  }

  const staged = init(state)
  const noted = note(staged, { comment: `storyboard export: ${project.name}` })
  return save(noted.repo)
}
