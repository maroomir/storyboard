import { serializeCard } from "@/files/card"
import { serializeProjectJson } from "@/files/projectJson"
import type { ParsedSeedEnvelope } from "@/models/serialization/seedFile"
import { isHiddenSceneFileName, isIgnoredSampleCardFileName } from "@/core/pathConventions"
import { parseSceneStem } from "@/shared/scene"

export interface SeedFileWriteEntry {
  readonly relativePath: string
  readonly content: string
}

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "")
}

export function isSeedSyncExcludedPath(normalizedRelativePath: string): boolean {
  const path = normalizedRelativePath
  return path.startsWith("draft/") || path.startsWith(".storyboard/cache/")
}

export function buildSeedWritePlan(seed: ParsedSeedEnvelope): readonly SeedFileWriteEntry[] {
  const entries: SeedFileWriteEntry[] = [
    { relativePath: ".storyboard/project.json", content: serializeProjectJson(seed.project) }
  ]

  const characters = [...seed.characters].sort((a, b) => a.id.localeCompare(b.id))
  for (const card of characters) {
    entries.push({
      relativePath: `character/${card.id}.card`,
      content: serializeCard(card)
    })
  }

  const backgrounds = [...seed.backgrounds].sort((a, b) => a.id.localeCompare(b.id))
  for (const card of backgrounds) {
    entries.push({
      relativePath: `background/${card.id}.card`,
      content: serializeCard(card)
    })
  }

  const scenes = [...seed.scenes].sort((a, b) => a.stem.localeCompare(b.stem))
  for (const scene of scenes) {
    entries.push({
      relativePath: `scene/${scene.stem}.txt`,
      content: scene.content
    })
  }

  return entries
}

export function computeSeedDeletionCandidates(
  existingRelativePaths: readonly string[],
  seed: ParsedSeedEnvelope
): readonly string[] {
  const characterIds = new Set(seed.characters.map((c) => c.id))
  const backgroundIds = new Set(seed.backgrounds.map((b) => b.id))
  const sceneStems = new Set(seed.scenes.map((s) => s.stem))

  const candidates = new Set<string>()

  for (const raw of existingRelativePaths) {
    const norm = normalizeRelativePath(raw)
    if (isSeedSyncExcludedPath(norm)) {
      continue
    }

    const characterId = parseCharacterRootCardId(norm)
    if (characterId !== undefined) {
      if (!characterIds.has(characterId)) {
        candidates.add(norm)
      }
      continue
    }

    const backgroundId = parseBackgroundRootCardId(norm)
    if (backgroundId !== undefined) {
      if (!backgroundIds.has(backgroundId)) {
        candidates.add(norm)
      }
      continue
    }

    const sceneStem = parseSceneRootTxtStem(norm)
    if (sceneStem !== undefined) {
      if (!sceneStems.has(sceneStem)) {
        candidates.add(norm)
      }
    }
  }

  return [...candidates].sort((a, b) => a.localeCompare(b))
}

function parseCharacterRootCardId(normalizedRelativePath: string): string | undefined {
  const match = /^character\/([^/]+\.card)$/.exec(normalizedRelativePath)
  const fileName = match?.[1]

  if (!fileName?.endsWith(".card")) {
    return undefined
  }

  if (isIgnoredSampleCardFileName(fileName)) {
    return undefined
  }

  return fileName.slice(0, -".card".length)
}

function parseBackgroundRootCardId(normalizedRelativePath: string): string | undefined {
  const match = /^background\/([^/]+\.card)$/.exec(normalizedRelativePath)
  const fileName = match?.[1]

  if (!fileName?.endsWith(".card")) {
    return undefined
  }

  if (isIgnoredSampleCardFileName(fileName)) {
    return undefined
  }

  return fileName.slice(0, -".card".length)
}

function parseSceneRootTxtStem(normalizedRelativePath: string): string | undefined {
  const match = /^scene\/([^/]+\.txt)$/.exec(normalizedRelativePath)
  const fileName = match?.[1]

  if (!fileName?.endsWith(".txt")) {
    return undefined
  }

  if (isHiddenSceneFileName(fileName)) {
    return undefined
  }

  const stem = fileName.slice(0, -".txt".length)

  if (parseSceneStem(stem) === undefined) {
    return undefined
  }

  return stem
}
