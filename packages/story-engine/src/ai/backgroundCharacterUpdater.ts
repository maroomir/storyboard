import type { StoryUri } from '@storyboard/story-format';
import { isBackgroundCard, readCardFile, writeCardFile } from '@storyboard/story-format';
import type { BackgroundCard, CardFileSystem, CharacterCard } from '@storyboard/story-format';
interface BackgroundCharacterUpdateLogger {
  readonly error: (message: string, error?: unknown) => void;
}

export interface BackgroundCharacterUpdateSummary {
  readonly updated: boolean;
}

export interface UpdateBackgroundCharactersFromSceneInput {
  readonly backgroundId: string;
  readonly detectedCharacterCards: readonly CharacterCard[];
  readonly fileSystem: CardFileSystem;
  readonly resolveBackgroundCardUri: (backgroundId: string) => StoryUri;
  readonly logger?: BackgroundCharacterUpdateLogger;
}

export async function updateBackgroundCharactersFromScene(
  input: UpdateBackgroundCharactersFromSceneInput,
): Promise<BackgroundCharacterUpdateSummary> {
  const { backgroundId, detectedCharacterCards, fileSystem, resolveBackgroundCardUri, logger } =
    input;

  if (detectedCharacterCards.length === 0) {
    return { updated: false };
  }

  const cardUri = resolveBackgroundCardUri(backgroundId);

  let current;
  try {
    current = await readCardFile(cardUri, fileSystem);
  } catch (error) {
    logger?.error(`Failed to read background card ${backgroundId}`, error);
    return { updated: false };
  }

  if (!isBackgroundCard(current)) {
    return { updated: false };
  }

  const existing = current.characterIds ?? [];
  const seen = new Set(existing);
  const additions = detectedCharacterCards.map((card) => card.id).filter((id) => !seen.has(id));

  if (additions.length === 0) {
    return { updated: false };
  }

  const merged = [...existing, ...new Set(additions)];
  const next: BackgroundCard = { ...current, characterIds: merged };

  try {
    await writeCardFile(cardUri, fileSystem, next);
  } catch (error) {
    logger?.error(`Failed to write background card ${backgroundId}`, error);
    return { updated: false };
  }

  return { updated: true };
}

export interface ScheduleBackgroundCharacterUpdateInput extends UpdateBackgroundCharactersFromSceneInput {
  readonly queueKey: string;
  readonly onComplete?: (summary: BackgroundCharacterUpdateSummary) => void;
}
