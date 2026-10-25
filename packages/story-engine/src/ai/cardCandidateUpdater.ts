import type {
  StoryUri,
  CharacterCard,
  UsageAttribution,
  CardArcCandidate,
  AttributeCandidate,
  CardCandidateCharacter,
  RelationLink,
CharacterRef,
} from '@storyboard/story-model';
import {
  type ReadWriteFileSystem,
  writeCardCandidateFile,
} from '@storyboard/story-model';
import type { CardCandidateExtraction, StoryboardAiService } from '@storyboard/story-ai';

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
  readonly characterRoster: readonly CharacterRef[];
  readonly aiService: Pick<
    StoryboardAiService,
    'extractCardCandidatesByCharacter' | 'verifyCardCandidatesByCharacter'
  >;
  readonly verify?: boolean;
  readonly fileSystem: ReadWriteFileSystem;
  readonly resolveCandidateUri: (sceneStem: string) => StoryUri;
  readonly ensureDirectory?: () => Promise<void>;
  readonly logger?: CardCandidateUpdateLogger;
}

export function buildTargetResolver(
  roster: readonly CharacterRef[],
): (rawTarget: string) => string | undefined {
  const idByName: Map<string, string> = new Map(roster.map((entry) => [entry.name, entry.id]));
  const ids: Set<string> = new Set(roster.map((entry) => entry.id));

  return (rawTarget) => {
    const target: string = rawTarget.trim();
    if (ids.has(target)) {
      return target;
    }
    return idByName.get(target);
  };
}

function dedupeRelations(relations: readonly RelationLink[]): RelationLink[] {
  const byKey: Map<string, RelationLink> = new Map<string, RelationLink>();
  for (const relation of relations) {
    byKey.set(`${relation.target}:${relation.type}`, relation);
  }
  return [...byKey.values()];
}

function dedupeAttributes(attributes: readonly AttributeCandidate[]): AttributeCandidate[] {
  const byKey: Map<string, AttributeCandidate> = new Map<string, AttributeCandidate>();
  for (const attribute of attributes) {
    byKey.set(attribute.key, attribute);
  }
  return [...byKey.values()];
}

function countCandidates(character: CardCandidateCharacter): number {
  return character.attributes.length + character.relations.length + character.arc.length;
}

interface VerifiableCandidates {
  readonly attributes: readonly AttributeCandidate[];
  readonly relations: readonly RelationLink[];
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
  const statements: string[] = buildCandidateStatements(candidates);

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

  const approved: Set<number> = new Set(approvedIndices);
  const relationOffset: number = candidates.attributes.length;
  const arcOffset: number = relationOffset + candidates.relations.length;

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
    const characterIdByName: Map<string, string> = new Map(detectedCharacterCards.map((card) => [card.name, card.id]));

    extracted = await aiService.extractCardCandidatesByCharacter(
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
    logger?.error('Card candidate extraction failed', error);

    return { characterCount: 0, candidateCount: 0 };
  }

  const resolveTarget: (rawTarget: string) => string | undefined = buildTargetResolver(characterRoster);

  const characters: CardCandidateCharacter[] = [];

  for (const card of detectedCharacterCards) {
    const candidate: CardCandidateExtraction | undefined = extracted[card.name];
    if (!candidate) {
      continue;
    }

    const relations: RelationLink[] = dedupeRelations(
      candidate.relations
        .map((relation) => {
          const target: string | undefined = resolveTarget(relation.target);
          return target && target !== card.id ? { target, type: relation.type } : undefined;
        })
        .filter((relation): relation is RelationLink => relation !== undefined),
    );

    const attributes: AttributeCandidate[] = dedupeAttributes(
      candidate.attributes.map((attribute) => ({ ...attribute })),
    );

    const arc: CardArcCandidate[] = candidate.arc?.summary
      ? [{ summary: candidate.arc.summary, sceneRef: sceneStem }]
      : [];

    const verified: VerifiableCandidates = input.verify
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

  const candidateCount: number = characters.reduce(
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
