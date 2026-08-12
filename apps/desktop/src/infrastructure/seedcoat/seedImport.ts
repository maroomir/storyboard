import { parseSceneStem, serializeCard } from '@seedkernel/wasm';
import { serializeProjectJson } from '@/infrastructure/persistence/projectJson';
import type { DecodedSeedContent } from '@/infrastructure/seedcoat/projectAdapter';
import {
  isHiddenSceneFileName,
  isIgnoredSampleCardFileName,
} from '@/infrastructure/vscode/pathConventions';
export interface SeedFileWriteEntry {
  readonly relativePath: string;
  readonly content: string;
}

export class SeedWriteAbortedError extends Error {
  public constructor(
    message: string,
    public readonly writtenRelativePaths: readonly string[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SeedWriteAbortedError';
  }
}

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function isSeedSyncExcludedPath(normalizedRelativePath: string): boolean {
  const path = normalizedRelativePath;
  return path.startsWith('draft/') || path.startsWith('.storyboard/cache/');
}

export function buildSeedWritePlan(seed: DecodedSeedContent): readonly SeedFileWriteEntry[] {
  const entries: SeedFileWriteEntry[] = [
    { relativePath: '.storyboard/project.json', content: serializeProjectJson(seed.project) },
  ];

  const characters = [...seed.characters].sort((a, b) => a.id.localeCompare(b.id));
  for (const card of characters) {
    entries.push({
      relativePath: `character/${card.id}.card`,
      content: serializeCard(card),
    });
  }

  const backgrounds = [...seed.backgrounds].sort((a, b) => a.id.localeCompare(b.id));
  for (const card of backgrounds) {
    entries.push({
      relativePath: `background/${card.id}.card`,
      content: serializeCard(card),
    });
  }

  const scenes = [...seed.scenes].sort((a, b) => a.stem.localeCompare(b.stem));
  for (const scene of scenes) {
    entries.push({
      relativePath: `scene/${scene.stem}.txt`,
      content: scene.content,
    });
  }

  return entries;
}

export function collectTrackedCardAndSceneRelativePathsFromFileNames(input: {
  readonly characterFileNames: readonly string[];
  readonly backgroundFileNames: readonly string[];
  readonly sceneFileNames: readonly string[];
}): string[] {
  const out: string[] = [];

  for (const name of input.characterFileNames) {
    const rel = `character/${name}`;
    if (parseCharacterRootCardId(rel) !== undefined) {
      out.push(rel);
    }
  }

  for (const name of input.backgroundFileNames) {
    const rel = `background/${name}`;
    if (parseBackgroundRootCardId(rel) !== undefined) {
      out.push(rel);
    }
  }

  for (const name of input.sceneFileNames) {
    const rel = `scene/${name}`;
    if (parseSceneRootTxtStem(rel) !== undefined) {
      out.push(rel);
    }
  }

  return out;
}

export function listSeedPlanContentConflictRelativePaths(
  plan: readonly SeedFileWriteEntry[],
  existingContentByRelativePath: ReadonlyMap<string, string | undefined>,
): string[] {
  const conflicts: string[] = [];

  for (const entry of plan) {
    const norm = normalizeRelativePath(entry.relativePath);
    const existing = existingContentByRelativePath.get(norm);

    if (existing !== undefined && existing !== entry.content) {
      conflicts.push(norm);
    }
  }

  return conflicts.sort((a, b) => a.localeCompare(b));
}

export function computeSeedDeletionCandidates(
  existingRelativePaths: readonly string[],
  seed: DecodedSeedContent,
): readonly string[] {
  const characterIds = new Set(seed.characters.map((c) => c.id));
  const backgroundIds = new Set(seed.backgrounds.map((b) => b.id));
  const sceneStems = new Set(seed.scenes.map((s) => s.stem));

  const candidates = new Set<string>();

  for (const raw of existingRelativePaths) {
    const norm = normalizeRelativePath(raw);
    if (isSeedSyncExcludedPath(norm)) {
      continue;
    }

    const characterId = parseCharacterRootCardId(norm);
    if (characterId !== undefined) {
      if (!characterIds.has(characterId)) {
        candidates.add(norm);
      }
      continue;
    }

    const backgroundId = parseBackgroundRootCardId(norm);
    if (backgroundId !== undefined) {
      if (!backgroundIds.has(backgroundId)) {
        candidates.add(norm);
      }
      continue;
    }

    const sceneStem = parseSceneRootTxtStem(norm);
    if (sceneStem !== undefined) {
      if (!sceneStems.has(sceneStem)) {
        candidates.add(norm);
      }
    }
  }

  return [...candidates].sort((a, b) => a.localeCompare(b));
}

function parseCharacterRootCardId(normalizedRelativePath: string): string | undefined {
  const match = /^character\/([^/]+\.card)$/.exec(normalizedRelativePath);
  const fileName = match?.[1];

  if (!fileName?.endsWith('.card')) {
    return undefined;
  }

  if (isIgnoredSampleCardFileName(fileName)) {
    return undefined;
  }

  return fileName.slice(0, -'.card'.length);
}

function parseBackgroundRootCardId(normalizedRelativePath: string): string | undefined {
  const match = /^background\/([^/]+\.card)$/.exec(normalizedRelativePath);
  const fileName = match?.[1];

  if (!fileName?.endsWith('.card')) {
    return undefined;
  }

  if (isIgnoredSampleCardFileName(fileName)) {
    return undefined;
  }

  return fileName.slice(0, -'.card'.length);
}

function parseSceneRootTxtStem(normalizedRelativePath: string): string | undefined {
  const match = /^scene\/([^/]+\.txt)$/.exec(normalizedRelativePath);
  const fileName = match?.[1];

  if (!fileName?.endsWith('.txt')) {
    return undefined;
  }

  if (isHiddenSceneFileName(fileName)) {
    return undefined;
  }

  const stem = fileName.slice(0, -'.txt'.length);

  if (parseSceneStem(stem) === undefined) {
    return undefined;
  }

  return stem;
}
