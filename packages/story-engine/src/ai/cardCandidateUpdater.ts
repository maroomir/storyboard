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

type CardCandidateExtractionsByName = Awaited<
  ReturnType<StoryboardAiService['extractCardCandidatesByCharacter']>
>;

async function extractCandidatesByCharacter(
  input: UpdateCardCandidatesFromDraftInput,
): Promise<CardCandidateExtractionsByName | undefined> {
  const { sceneStem, draftBody, detectedCharacterCards, aiService, logger } = input;

  try {
    const characterIdByName: Map<string, string> = new Map(
      detectedCharacterCards.map((card) => [card.name, card.id]),
    );

    return await aiService.extractCardCandidatesByCharacter(
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

    return undefined;
  }
}

function resolveCandidateRelations(
  candidate: CardCandidateExtraction,
  card: CharacterCard,
  resolveTarget: (rawTarget: string) => string | undefined,
): RelationLink[] {
  return dedupeRelations(
    candidate.relations
      .map((relation) => {
        const target: string | undefined = resolveTarget(relation.target);
        return target && target !== card.id ? { target, type: relation.type } : undefined;
      })
      .filter((relation): relation is RelationLink => relation !== undefined),
  );
}

async function buildCandidateCharacter(
  input: UpdateCardCandidatesFromDraftInput,
  card: CharacterCard,
  candidate: CardCandidateExtraction,
  resolveTarget: (rawTarget: string) => string | undefined,
): Promise<CardCandidateCharacter> {
  const relations: RelationLink[] = resolveCandidateRelations(candidate, card, resolveTarget);

  const attributes: AttributeCandidate[] = dedupeAttributes(
    candidate.attributes.map((attribute) => ({ ...attribute })),
  );

  const arc: CardArcCandidate[] = candidate.arc?.summary
    ? [{ summary: candidate.arc.summary, sceneRef: input.sceneStem }]
    : [];

  const verified: VerifiableCandidates = input.verify
    ? await verifyCandidates(input, card, { attributes, relations, arc })
    : { attributes, relations, arc };

  return {
    cardId: card.id,
    attributes: [...verified.attributes],
    relations: [...verified.relations],
    arc: [...verified.arc],
  };
}

async function collectCandidateCharacters(
  input: UpdateCardCandidatesFromDraftInput,
  extracted: CardCandidateExtractionsByName,
): Promise<CardCandidateCharacter[]> {
  const resolveTarget: (rawTarget: string) => string | undefined = buildTargetResolver(
    input.characterRoster,
  );

  const characters: CardCandidateCharacter[] = [];

  for (const card of input.detectedCharacterCards) {
    const candidate: CardCandidateExtraction | undefined = extracted[card.name];
    if (!candidate) {
      continue;
    }

    const character: CardCandidateCharacter = await buildCandidateCharacter(
      input,
      card,
      candidate,
      resolveTarget,
    );

    if (countCandidates(character) > 0) {
      characters.push(character);
    }
  }

  return characters;
}

async function writeCandidateCharacters(
  input: UpdateCardCandidatesFromDraftInput,
  characters: CardCandidateCharacter[],
): Promise<CardCandidateUpdateSummary> {
  const { sceneStem, fileSystem, logger } = input;
  const candidateCount: number = characters.reduce(
    (total, character) => total + countCandidates(character),
    0,
  );

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

export async function updateCardCandidatesFromDraft(
  input: UpdateCardCandidatesFromDraftInput,
): Promise<CardCandidateUpdateSummary> {
  if (input.detectedCharacterCards.length === 0) {
    return { characterCount: 0, candidateCount: 0 };
  }

  const extracted: CardCandidateExtractionsByName | undefined =
    await extractCandidatesByCharacter(input);
  if (extracted === undefined) {
    return { characterCount: 0, candidateCount: 0 };
  }

  const characters: CardCandidateCharacter[] = await collectCandidateCharacters(input, extracted);

  if (characters.length === 0) {
    return { characterCount: 0, candidateCount: 0 };
  }

  return await writeCandidateCharacters(input, characters);
}

export interface ScheduleCardCandidateUpdateInput extends UpdateCardCandidatesFromDraftInput {
  readonly queueKey: string;
  readonly onComplete?: (summary: CardCandidateUpdateSummary) => void;
}
