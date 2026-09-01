import type { StoryUri } from '@storyboard/story-format';
import { buildCandidateFact } from '@storyboard/story-format';
import type { BibleFact, CharacterCard } from '@storyboard/story-format';
import {
  type BibleCandidateFileSystem,
  writeBibleCandidateFile,
} from '../domain/files/bibleCandidates';
import type { StoryboardAiService, UsageAttribution } from '@storyboard/story-ai';
interface BibleCandidateUpdateLogger {
  readonly error: (message: string, error?: unknown) => void;
}

export interface BibleCandidateUpdateSummary {
  readonly candidateCount: number;
}

export interface UpdateBibleCandidatesFromDraftInput {
  readonly sceneStem: string;
  readonly draftBody: string;
  readonly detectedCharacterCards: readonly CharacterCard[];
  readonly aiService: Pick<StoryboardAiService, 'extractFactsByCharacter'>;
  readonly fileSystem: BibleCandidateFileSystem;
  readonly resolveCandidateUri: (sceneStem: string) => StoryUri;
  readonly ensureDirectory?: () => Promise<void>;
  readonly logger?: BibleCandidateUpdateLogger;
}

function dedupeFactsById(facts: readonly BibleFact[]): BibleFact[] {
  const byId = new Map<string, BibleFact>();

  for (const fact of facts) {
    byId.set(fact.id, fact);
  }

  return [...byId.values()];
}

export async function updateBibleCandidatesFromDraft(
  input: UpdateBibleCandidatesFromDraftInput,
): Promise<BibleCandidateUpdateSummary> {
  const { sceneStem, draftBody, detectedCharacterCards, aiService, fileSystem, logger } = input;

  if (detectedCharacterCards.length === 0) {
    return { candidateCount: 0 };
  }

  let extracted: Record<string, { key: string; value: string }[]>;

  try {
    const characterIdByName = new Map(detectedCharacterCards.map((card) => [card.name, card.id]));

    extracted = await aiService.extractFactsByCharacter(
      draftBody,
      detectedCharacterCards.map((card) => card.name),
      {
        attributionForCharacter: (name: string): UsageAttribution | undefined => {
          const characterId = characterIdByName.get(name);

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
    logger?.error('Fact extraction failed', error);

    return { candidateCount: 0 };
  }

  const facts = detectedCharacterCards.flatMap((card) =>
    (extracted[card.name] ?? []).map((candidate) =>
      buildCandidateFact(
        { kind: 'character', id: card.id },
        candidate.key,
        candidate.value,
        sceneStem,
      ),
    ),
  );
  const deduped = dedupeFactsById(facts);

  if (deduped.length === 0) {
    return { candidateCount: 0 };
  }

  try {
    await input.ensureDirectory?.();
    await writeBibleCandidateFile(input.resolveCandidateUri(sceneStem), fileSystem, {
      sceneStem,
      generatedAt: new Date().toISOString(),
      facts: deduped,
    });
  } catch (error) {
    logger?.error('Failed to write bible candidates', error);

    return { candidateCount: 0 };
  }

  return { candidateCount: deduped.length };
}

export interface ScheduleBibleCandidateUpdateInput extends UpdateBibleCandidatesFromDraftInput {
  readonly queueKey: string;
  readonly onComplete?: (summary: BibleCandidateUpdateSummary) => void;
}
