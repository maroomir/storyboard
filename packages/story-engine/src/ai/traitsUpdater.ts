import type {
  StoryUri,
  CardFileSystem,
  CharacterCard,
  UsageAttribution,
  StoryboardCard,
} from '@storyboard/story-model';
import {
  readCardFile,
  writeCardFile,
  parseBulletList,
  reconcileCharacterTraits,
} from '@storyboard/story-model';
import type { StoryboardAiService } from '@storyboard/story-ai';
interface TraitsUpdateLogger {
  readonly error: (message: string, error?: unknown) => void;
}

export interface TraitsUpdateSummary {
  readonly updatedCardCount: number;
  readonly skippedUnchangedCount: number;
}

export interface UpdateCharacterTraitsFromDraftInput {
  readonly sceneStem?: string;
  readonly draftBody: string;
  readonly detectedCharacterCards: readonly CharacterCard[];
  readonly aiService: Pick<StoryboardAiService, 'extractTraitsByCharacter'>;
  readonly fileSystem: CardFileSystem;
  readonly resolveCharacterCardUri: (card: CharacterCard) => StoryUri;
  readonly recentDialogueLimit?: number;
  readonly logger?: TraitsUpdateLogger;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractQuotedUtterancesForCharacter(
  script: string,
  characterName: string,
  aliases?: readonly string[],
): string[] {
  const utterances: string[] = [];
  const speakerNames: string[] = [characterName, ...(aliases ?? [])]
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const speaker: RegExp = new RegExp(
    `^\\s*(?:${speakerNames.map(escapeRegExp).join('|')})\\s*:\\s*(.+)$`,
  );

  for (const rawLine of script.split(/\r?\n/)) {
    const match: RegExpExecArray | null = speaker.exec(rawLine);

    if (!match) {
      continue;
    }

    collectQuotedStrings(match[1] ?? '', utterances);
  }

  return utterances;
}

function collectQuotedStrings(text: string, out: string[]): void {
  const quotePatterns: RegExp[] = [/"([^"]+)"/g, /「([^」]+)」/g, /'([^']+)'/g];

  for (const pattern of quotePatterns) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const raw: string = (match[1] ?? '').trim();

      if (raw.length >= 2) {
        out.push(raw);
      }
    }
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

async function extractTraitsForCards(
  input: UpdateCharacterTraitsFromDraftInput,
): Promise<Record<string, string[]> | undefined> {
  const { draftBody, detectedCharacterCards, aiService, logger } = input;
  const sceneStem: string | undefined = input.sceneStem;
  const characterIdByName: Map<string, string> = new Map(
    detectedCharacterCards.map((card) => [card.name, card.id]),
  );

  try {
    return await aiService.extractTraitsByCharacter(
      draftBody,
      detectedCharacterCards.map((card) => card.name),
      sceneStem === undefined
        ? {}
        : {
            attributionForCharacter: (name: string): UsageAttribution | undefined => {
              const characterId: string | undefined = characterIdByName.get(name);

              if (!characterId) {
                return undefined;
              }

              return {
                primary: { kind: 'character' as const, id: characterId },
                participants: [{ kind: 'scene' as const, id: sceneStem }],
              };
            },
          },
    );
  } catch (error) {
    logger?.error('Traits extraction failed', error);

    return undefined;
  }
}

async function loadExistingTraits(
  detectedCharacterCards: readonly CharacterCard[],
  readCharacterCard: (ref: CharacterCard) => ReturnType<typeof readCardFile>,
): Promise<Record<string, readonly string[]>> {
  const existingTraits: Record<string, readonly string[]> = {};

  for (const ref of detectedCharacterCards) {
    try {
      const current: StoryboardCard = await readCharacterCard(ref);

      if (current.type === 'character') {
        existingTraits[ref.name] = current.traits ?? [];
      }
    } catch {
      existingTraits[ref.name] = ref.traits ?? [];
    }
  }

  return existingTraits;
}

type TraitsCardOutcome = 'updated' | 'skipped' | 'noop';

async function applyTraitsToCard(args: {
  readonly ref: CharacterCard;
  readonly processed: ReturnType<typeof reconcileCharacterTraits>;
  readonly draftBody: string;
  readonly limit: number;
  readonly fileSystem: CardFileSystem;
  readonly resolveCharacterCardUri: (card: CharacterCard) => StoryUri;
}): Promise<TraitsCardOutcome> {
  const { ref, processed, draftBody, limit, fileSystem, resolveCharacterCardUri } = args;
  const cardUri: StoryUri = resolveCharacterCardUri(ref);
  const current: StoryboardCard = await readCardFile(cardUri, fileSystem);

  if (current.type !== 'character') {
    return 'noop';
  }

  const additions: string[] = processed[current.name] ?? [];
  const quoted: string[] = extractQuotedUtterancesForCharacter(draftBody, current.name);
  const mergedTraits: string[] = [...(current.traits ?? []), ...additions];
  const mergedRecent: string[] = [...(current.recentDialogues ?? []), ...quoted].slice(-limit);
  const traitsUnchanged: boolean = sameStringArray(mergedTraits, current.traits ?? []);
  const recentUnchanged: boolean = sameStringArray(mergedRecent, current.recentDialogues ?? []);

  if (traitsUnchanged && recentUnchanged) {
    return 'skipped';
  }

  const next: CharacterCard = {
    ...current,
    traits: mergedTraits,
    recentDialogues: mergedRecent,
  };

  await writeCardFile(cardUri, fileSystem, next);

  return 'updated';
}

export async function updateCharacterTraitsFromDraft(
  input: UpdateCharacterTraitsFromDraftInput,
): Promise<TraitsUpdateSummary> {
  const limit: number = input.recentDialogueLimit ?? 8;
  const { draftBody, detectedCharacterCards, fileSystem, logger } = input;

  const readCharacterCard = (ref: CharacterCard): ReturnType<typeof readCardFile> =>
    readCardFile(input.resolveCharacterCardUri(ref), fileSystem);

  if (detectedCharacterCards.length === 0) {
    return { updatedCardCount: 0, skippedUnchangedCount: 0 };
  }

  const extracted: Record<string, string[]> | undefined = await extractTraitsForCards(input);
  if (extracted === undefined) {
    return { updatedCardCount: 0, skippedUnchangedCount: 0 };
  }

  const existingTraits: Record<string, readonly string[]> = await loadExistingTraits(
    detectedCharacterCards,
    readCharacterCard,
  );
  const processed: Record<string, string[]> = reconcileCharacterTraits(extracted, existingTraits);

  let updatedCardCount: number = 0;
  let skippedUnchangedCount: number = 0;

  for (const ref of detectedCharacterCards) {
    try {
      const outcome: TraitsCardOutcome = await applyTraitsToCard({
        ref,
        processed,
        draftBody,
        limit,
        fileSystem,
        resolveCharacterCardUri: input.resolveCharacterCardUri,
      });

      if (outcome === 'updated') {
        updatedCardCount += 1;
      } else if (outcome === 'skipped') {
        skippedUnchangedCount += 1;
      }
    } catch (error) {
      logger?.error(`Failed to update traits for character ${ref.name}`, error);
    }
  }

  return { updatedCardCount, skippedUnchangedCount };
}

export interface ScheduleCharacterTraitsUpdateInput extends UpdateCharacterTraitsFromDraftInput {
  readonly queueKey: string;
  readonly onComplete?: (summary: TraitsUpdateSummary) => void;
}

export function applyTraitsFromExtractedBullets(input: {
  readonly draftBody: string;
  readonly detectedCharacterCards: readonly CharacterCard[];
  readonly rawResponsesByCharacter: Readonly<Record<string, string>>;
  readonly fileSystem: CardFileSystem;
  readonly resolveCharacterCardUri: (card: CharacterCard) => StoryUri;
  readonly recentDialogueLimit?: number;
}): Promise<TraitsUpdateSummary> {
  const fakeService: Pick<StoryboardAiService, 'extractTraitsByCharacter'> = {
    extractTraitsByCharacter: async (_draft, names) => {
      const result: Record<string, string[]> = {};

      for (const name of names) {
        const raw: string | undefined = input.rawResponsesByCharacter[name];

        if (raw !== undefined) {
          result[name] = parseBulletList(raw);
        }
      }

      return result;
    },
  };

  return updateCharacterTraitsFromDraft({
    draftBody: input.draftBody,
    detectedCharacterCards: input.detectedCharacterCards,
    aiService: fakeService,
    fileSystem: input.fileSystem,
    resolveCharacterCardUri: input.resolveCharacterCardUri,
    recentDialogueLimit: input.recentDialogueLimit,
  });
}
