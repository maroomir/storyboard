import type { StoryUri, BibleFact, CharacterCard, UsageAttribution } from '@storyboard/story-model';
import {
  buildCandidateFact,
  type ReadWriteFileSystem,
  writeBibleCandidateFile,
} from '@storyboard/story-model';
import type { StoryboardAiService } from '@storyboard/story-ai';
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
  readonly fileSystem: ReadWriteFileSystem;
  readonly resolveCandidateUri: (sceneStem: string) => StoryUri;
  readonly ensureDirectory?: () => Promise<void>;
  readonly logger?: BibleCandidateUpdateLogger;
}

function dedupeFactsById(facts: readonly BibleFact[]): BibleFact[] {
  const byId: Map<string, BibleFact> = new Map<string, BibleFact>();

  for (const fact of facts) {
    byId.set(fact.id, fact);
  }

  return [...byId.values()];
}

type ExtractedFactsByName = Record<string, { key: string; value: string }[]>;

async function extractFactsByCharacter(
  input: UpdateBibleCandidatesFromDraftInput,
): Promise<ExtractedFactsByName | undefined> {
  const { sceneStem, draftBody, detectedCharacterCards, aiService, logger } = input;

  try {
    const characterIdByName: Map<string, string> = new Map(
      detectedCharacterCards.map((card) => [card.name, card.id]),
    );

    return await aiService.extractFactsByCharacter(
      draftBody,
      detectedCharacterCards.map((card) => card.name),
      {
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
    logger?.error('Fact extraction failed', error);

    return undefined;
  }
}

function buildCandidateFacts(
  detectedCharacterCards: readonly CharacterCard[],
  extracted: ExtractedFactsByName,
  sceneStem: string,
): BibleFact[] {
  const facts: BibleFact[] = detectedCharacterCards.flatMap((card) =>
    (extracted[card.name] ?? []).map((candidate) =>
      buildCandidateFact(
        { kind: 'character', id: card.id },
        candidate.key,
        candidate.value,
        sceneStem,
      ),
    ),
  );
  return dedupeFactsById(facts);
}

async function writeCandidateFacts(
  input: UpdateBibleCandidatesFromDraftInput,
  facts: BibleFact[],
): Promise<BibleCandidateUpdateSummary> {
  const { sceneStem, fileSystem, logger } = input;

  try {
    await input.ensureDirectory?.();
    await writeBibleCandidateFile(input.resolveCandidateUri(sceneStem), fileSystem, {
      sceneStem,
      generatedAt: new Date().toISOString(),
      facts,
    });
  } catch (error) {
    logger?.error('Failed to write bible candidates', error);

    return { candidateCount: 0 };
  }

  return { candidateCount: facts.length };
}

export async function updateBibleCandidatesFromDraft(
  input: UpdateBibleCandidatesFromDraftInput,
): Promise<BibleCandidateUpdateSummary> {
  if (input.detectedCharacterCards.length === 0) {
    return { candidateCount: 0 };
  }

  const extracted: ExtractedFactsByName | undefined = await extractFactsByCharacter(input);
  if (extracted === undefined) {
    return { candidateCount: 0 };
  }

  const deduped: BibleFact[] = buildCandidateFacts(
    input.detectedCharacterCards,
    extracted,
    input.sceneStem,
  );

  if (deduped.length === 0) {
    return { candidateCount: 0 };
  }

  return await writeCandidateFacts(input, deduped);
}

export interface ScheduleBibleCandidateUpdateInput extends UpdateBibleCandidatesFromDraftInput {
  readonly queueKey: string;
  readonly onComplete?: (summary: BibleCandidateUpdateSummary) => void;
}
