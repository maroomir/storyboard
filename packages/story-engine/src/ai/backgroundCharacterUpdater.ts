import type {
  StoryUri,
  BackgroundCard,
  ReadWriteFileSystem,
  CharacterCard,
  StoryboardCard,
} from '@storyboard/story-model';
import { isBackgroundCard, readCardFile, writeCardFile } from '@storyboard/story-model';
interface BackgroundCharacterUpdateLogger {
  readonly error: (message: string, error?: unknown) => void;
}

export interface BackgroundCharacterUpdateSummary {
  readonly updated: boolean;
}

export interface UpdateBackgroundCharactersFromSceneInput {
  readonly backgroundId: string;
  readonly detectedCharacterCards: readonly CharacterCard[];
  readonly fileSystem: ReadWriteFileSystem;
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

  const cardUri: StoryUri = resolveBackgroundCardUri(backgroundId);

  let current: StoryboardCard;
  try {
    current = await readCardFile(cardUri, fileSystem);
  } catch (error) {
    logger?.error(`Failed to read background card ${backgroundId}`, error);
    return { updated: false };
  }

  if (!isBackgroundCard(current)) {
    return { updated: false };
  }

  const existing: string[] = current.characterIds ?? [];
  const seen: Set<string> = new Set(existing);
  const additions: string[] = detectedCharacterCards
    .map((card) => card.id)
    .filter((id) => !seen.has(id));

  if (additions.length === 0) {
    return { updated: false };
  }

  const merged: string[] = [...existing, ...new Set(additions)];
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
