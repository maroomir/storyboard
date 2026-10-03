import type { StoryUri, CharacterCard, UsageAttribution } from '@storyboard/story-model';
import type {
  CardArcCandidate,
  CardAttributeCandidate,
  CardCandidateCharacter,
  CardRelationCandidate,
} from '#engine/shared/cardCandidates';
import {
  type CardCandidateFileSystem,
  writeCardCandidateFile,
} from '#engine/domain/files/cardCandidates';
import type { StoryboardAiService } from '@storyboard/story-ai';
interface CardCandidateRosterEntry {
  readonly id: string;
  readonly name: string;
}

interface CardCandidateUpdateLogger {
  readonly error: (message: string, error?: unknown) => void;
}

export interface CardCandidateUpdateSummary {
  readonly characterCount: number;
  readonly candidateCount: number;
}

export interface UpdateCardCandidatesFromDraftInput {
  readonly sceneStem: string;
  readonly draftBody: string;
  readonly detectedCharacterCards: readonly CharacterCard[];
  readonly characterRoster: readonly CardCandidateRosterEntry[];
  readonly aiService: Pick<
    StoryboardAiService,
    'extractCardCandidatesByCharacter' | 'verifyCardCandidatesByCharacter'
  >;
  readonly verify?: boolean;
  readonly fileSystem: CardCandidateFileSystem;
  readonly resolveCandidateUri: (sceneStem: string) => StoryUri;
  readonly ensureDirectory?: () => Promise<void>;
  readonly logger?: CardCandidateUpdateLogger;
}

function buildTargetResolver(
  roster: readonly CardCandidateRosterEntry[],
): (rawTarget: string) => string | undefined {
  const idByName = new Map(roster.map((entry) => [entry.name, entry.id]));
  const ids = new Set(roster.map((entry) => entry.id));

  return (rawTarget) => {
    const target = rawTarget.trim();
    if (ids.has(target)) {
      return target;
    }
    return idByName.get(target);
  };
}

function dedupeRelations(relations: readonly CardRelationCandidate[]): CardRelationCandidate[] {
  const byKey = new Map<string, CardRelationCandidate>();
  for (const relation of relations) {
    byKey.set(`${relation.target}:${relation.type}`, relation);
  }
  return [...byKey.values()];
}

function dedupeAttributes(attributes: readonly CardAttributeCandidate[]): CardAttributeCandidate[] {
  const byKey = new Map<string, CardAttributeCandidate>();
  for (const attribute of attributes) {
    byKey.set(attribute.key, attribute);
  }
  return [...byKey.values()];
}

function countCandidates(character: CardCandidateCharacter): number {
  return character.attributes.length + character.relations.length + character.arc.length;
}

interface VerifiableCandidates {
  readonly attributes: readonly CardAttributeCandidate[];
  readonly relations: readonly CardRelationCandidate[];
  readonly arc: readonly CardArcCandidate[];
}

function buildCandidateStatements(candidates: VerifiableCandidates): string[] {
  return [
    ...candidates.attributes.map((attribute) => `속성 ${attribute.key}: ${attribute.value}`),
    ...candidates.relations.map((relation) => `관계 ${relation.target}: ${relation.type}`),
    ...candidates.arc.map((entry) => `아크: ${entry.summary}`),
  ];
}

async function verifyCandidates(
  input: UpdateCardCandidatesFromDraftInput,
  card: CharacterCard,
  candidates: VerifiableCandidates,
): Promise<VerifiableCandidates> {
  const statements = buildCandidateStatements(candidates);

  if (statements.length === 0) {
    return candidates;
  }

  let approvedIndices: number[] | null;

  try {
    approvedIndices = await input.aiService.verifyCardCandidatesByCharacter(
      input.draftBody,
      card.name,
      statements,
      {
        attribution: {
          primary: { kind: 'character' as const, id: card.id },
          participants: [{ kind: 'scene' as const, id: input.sceneStem }],
        },
      },
    );
  } catch (error) {
    input.logger?.error('Card candidate verification failed', error);
    approvedIndices = null;
  }

  if (approvedIndices === null) {
    return candidates;
  }

  const approved = new Set(approvedIndices);
  const relationOffset = candidates.attributes.length;
  const arcOffset = relationOffset + candidates.relations.length;

  return {
    attributes: candidates.attributes.filter((_, index) => approved.has(index)),
    relations: candidates.relations.filter((_, index) => approved.has(relationOffset + index)),
    arc: candidates.arc.filter((_, index) => approved.has(arcOffset + index)),
  };
}

export async function updateCardCandidatesFromDraft(
  input: UpdateCardCandidatesFromDraftInput,
): Promise<CardCandidateUpdateSummary> {
  const {
    sceneStem,
    draftBody,
    detectedCharacterCards,
    characterRoster,
    aiService,
    fileSystem,
    logger,
  } = input;

  if (detectedCharacterCards.length === 0) {
    return { characterCount: 0, candidateCount: 0 };
  }

  let extracted: Awaited<ReturnType<StoryboardAiService['extractCardCandidatesByCharacter']>>;

  try {
    const characterIdByName = new Map(detectedCharacterCards.map((card) => [card.name, card.id]));

    extracted = await aiService.extractCardCandidatesByCharacter(
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
    logger?.error('Card candidate extraction failed', error);

    return { characterCount: 0, candidateCount: 0 };
  }

  const resolveTarget = buildTargetResolver(characterRoster);

  const characters: CardCandidateCharacter[] = [];

  for (const card of detectedCharacterCards) {
    const candidate = extracted[card.name];
    if (!candidate) {
      continue;
    }

    const relations = dedupeRelations(
      candidate.relations
        .map((relation) => {
          const target = resolveTarget(relation.target);
          return target && target !== card.id ? { target, type: relation.type } : undefined;
        })
        .filter((relation): relation is CardRelationCandidate => relation !== undefined),
    );

    const attributes = dedupeAttributes(
      candidate.attributes.map((attribute) => ({ ...attribute })),
    );

    const arc: CardArcCandidate[] = candidate.arc?.summary
      ? [{ summary: candidate.arc.summary, sceneRef: sceneStem }]
      : [];

    const verified = input.verify
      ? await verifyCandidates(input, card, { attributes, relations, arc })
      : { attributes, relations, arc };

    const character: CardCandidateCharacter = {
      cardId: card.id,
      attributes: [...verified.attributes],
      relations: [...verified.relations],
      arc: [...verified.arc],
    };

    if (countCandidates(character) > 0) {
      characters.push(character);
    }
  }

  const candidateCount = characters.reduce(
    (total, character) => total + countCandidates(character),
    0,
  );

  if (characters.length === 0) {
    return { characterCount: 0, candidateCount: 0 };
  }

  try {
    await input.ensureDirectory?.();
    await writeCardCandidateFile(input.resolveCandidateUri(sceneStem), fileSystem, {
      sceneStem,
      generatedAt: new Date().toISOString(),
      characters,
    });
  } catch (error) {
    logger?.error('Failed to write card candidates', error);

    return { characterCount: 0, candidateCount: 0 };
  }

  return { characterCount: characters.length, candidateCount };
}

export interface ScheduleCardCandidateUpdateInput extends UpdateCardCandidatesFromDraftInput {
  readonly queueKey: string;
  readonly onComplete?: (summary: CardCandidateUpdateSummary) => void;
}
