import { flagBoolean, flagString, type ParsedArguments } from '@/cliArguments';
import { cardCategories } from '@/commands/catalog';
import type { CommandHandler } from '@/commands/outcome';
import { describeNothingToPromote, failure, success } from '@/commands/outcomes';
import type { CardReading } from '@storyboard/story-app';
import type {
  BuildStoryCardsProposal,
  DiscardNoteCandidatesResult,
  PrepareCardCandidatePromotionResult,
  PrepareNoteCandidatePromotionResult,
  PromoteCardCandidatesResult,
  PromoteNoteCandidatesResult,
  RecommendCardsResult,
  RenameCardResult,
} from '@storyboard/story-engine';
import {
  createEmptyBackground,
  createEmptyCharacter,
  serializeCard,
  slugify,
  type BibleSubjectKind,
  type CardCandidateItem,
  type Character,
  type CharacterRole,
  type LocationBackgroundCard,
  type MergedNoteCardCandidate,
  type StoryUri,
} from '@storyboard/story-model';

function describeNoteConflicts(cards: readonly MergedNoteCardCandidate[]): string[] {
  const lines: string[] = cards.flatMap((card) =>
    card.conflicts.flatMap((conflict) => [
      `  보류      ${card.cardId} ${conflict.key} — 노트마다 값이 다릅니다`,
      ...conflict.options.map(
        (option) => `    [${option.ref}] ${option.value} ← ${option.locations.join(', ')}`,
      ),
    ]),
  );

  return lines.length === 0
    ? []
    : [...lines, '  하나만 남기려면: storyboard card discard <id> --change <ref>'];
}

export const promoteCards: CommandHandler = async ({ container, args }) => {
  const prepared: PrepareCardCandidatePromotionResult =
    await container.cards.prepareCandidatePromotion(container.workspaceRoot);
  const preparedNotes: PrepareNoteCandidatePromotionResult =
    await container.notes.prepareCandidatePromotion(container.workspaceRoot);

  if (prepared.kind !== 'ready' && preparedNotes.kind !== 'ready') {
    const kind: 'no_candidates' | 'no_new_candidates' =
      prepared.kind === 'no_candidates' && preparedNotes.kind === 'no_candidates'
        ? 'no_candidates'
        : 'no_new_candidates';
    return success(describeNothingToPromote(kind), { kind });
  }

  const draftItems: readonly CardCandidateItem[] = prepared.kind === 'ready' ? prepared.items : [];
  const noteCandidates: readonly MergedNoteCardCandidate[] =
    preparedNotes.kind === 'ready' ? preparedNotes.candidates : [];
  const conflictedCards: MergedNoteCardCandidate[] = [
    ...noteCandidates,
    ...(preparedNotes.kind === 'ready' ? preparedNotes.heldCards : []),
  ].filter((candidate) => candidate.conflicts.length > 0);
  const conflictLines: string[] = describeNoteConflicts(conflictedCards);

  if (flagBoolean(args.flags, 'dry-run')) {
    return success(
      [
        `승격 후보 ${draftItems.length + noteCandidates.length}건`,
        ...(draftItems.length > 0 ? [`  초안에서  ${draftItems.length}건`] : []),
        ...noteCandidates.map(
          (candidate) =>
            `  노트에서  ${candidate.cardId} (${candidate.name}) 변경 ${candidate.changes.length}건 ← ${candidate.locations.join(', ')}`,
        ),
        ...conflictLines,
      ].join('\n'),
      { drafts: draftItems, notes: noteCandidates, conflicts: conflictedCards },
    );
  }

  const promotion: PromoteCardCandidatesResult | undefined =
    draftItems.length > 0
      ? await container.cards.promoteCandidates(container.workspaceRoot, draftItems)
      : undefined;
  const noteResult: PromoteNoteCandidatesResult | undefined =
    noteCandidates.length > 0
      ? await container.notes.promoteCandidates(container.workspaceRoot, noteCandidates)
      : undefined;
  const isDraftSaveFailed: boolean = promotion !== undefined && promotion.kind !== 'promoted';
  const updatedCardCount: number =
    (promotion?.kind === 'promoted' ? promotion.updatedCardCount : 0) +
    (noteResult?.updatedCardIds.length ?? 0);

  return {
    ok: !isDraftSaveFailed,
    message: isDraftSaveFailed
      ? '카드를 저장하지 못했습니다.'
      : [`카드 ${updatedCardCount}개를 갱신했습니다.`, ...conflictLines].join('\n'),
    data: { drafts: promotion ?? null, notes: noteResult ?? null, conflicts: conflictedCards },
  };
};

export const discardCardCandidates: CommandHandler = async ({ container, args }) => {
  const invalidId: string | undefined = args.positionals.find((id) => !cardIdPattern.test(id));

  if (invalidId !== undefined) {
    return failure(`카드 id 가 올바르지 않습니다: ${invalidId}`);
  }

  const changeRef: string | undefined = flagString(args.flags, 'change');

  if (changeRef !== undefined) {
    const [cardId] = args.positionals;

    if (cardId === undefined || args.positionals.length > 1) {
      return failure('--change 는 카드 id 하나와 함께 씁니다: card discard <id> --change <ref>');
    }

    const discard: DiscardNoteCandidatesResult = await container.notes.discardCandidates(
      container.workspaceRoot,
      {
        kind: 'change',
        cardId,
        ref: changeRef,
      },
    );

    return discard.kind === 'change_not_found'
      ? failure(
          `${cardId} 의 노트 후보에 ${changeRef} 가 없습니다. card promote --dry-run 으로 확인하세요.`,
        )
      : success(`${cardId} 의 노트 후보 ${changeRef} 를 버렸습니다.`, discard);
  }

  const cardIds: Set<string> | undefined =
    args.positionals.length > 0 ? new Set(args.positionals) : undefined;
  const notes: DiscardNoteCandidatesResult = await container.notes.discardCandidates(
    container.workspaceRoot,
    {
      kind: 'cards',
      ...(cardIds === undefined ? {} : { cardIds }),
    },
  );
  const draftItemCount: number = await container.cards.discardCandidates(
    container.workspaceRoot,
    cardIds,
  );
  const noteCardIds: readonly string[] = notes.kind === 'discarded' ? notes.cardIds : [];

  if (noteCardIds.length === 0 && draftItemCount === 0) {
    return success('버릴 후보가 없습니다.', { notes: [], drafts: 0 });
  }

  return success(
    [
      '후보를 버렸습니다.',
      ...(noteCardIds.length > 0 ? [`  노트에서  ${noteCardIds.join(', ')}`] : []),
      ...(draftItemCount > 0 ? [`  초안에서  ${draftItemCount}건`] : []),
    ].join('\n'),
    { notes: noteCardIds, drafts: draftItemCount },
  );
};

export const recommendCards: CommandHandler = async ({ container, args }) => {
  const category: BibleSubjectKind | undefined = cardCategoryFrom(args);

  if (category === undefined) {
    return failure(describeMissingCardCategory('card recommend'));
  }

  const recommendation: RecommendCardsResult = await container.cards.recommend({
    category,
    workspaceRoot: container.workspaceRoot,
  });

  if (!recommendation.ok) {
    return failure(
      recommendation.kind === 'cancelled' ? '취소했습니다.' : recommendation.message,
      recommendation,
    );
  }

  return recommendation.kind === 'no_sources'
    ? success('훑을 씬이나 초안이 없습니다.', [])
    : success(
        `카드가 없는 ${category} ${recommendation.recommendations.length}건`,
        recommendation.recommendations,
      );
};

const cardIdPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

function cardCategoryFrom(args: ParsedArguments): BibleSubjectKind | undefined {
  return cardCategories.find((category) => category === args.positionals[0]);
}

function describeMissingCardCategory(verb: string): string {
  return `카드 종류를 지정해 주세요: storyboard ${verb} <${cardCategories.join('|')}>`;
}

export const renameCard: CommandHandler = async ({ container, args }) => {
  const category: BibleSubjectKind | undefined = cardCategoryFrom(args);
  const fromId: string | undefined = args.positionals[1];
  const toId: string | undefined = flagString(args.flags, 'to');

  if (category === undefined) {
    return failure(describeMissingCardCategory('card rename'));
  }

  if (fromId === undefined || toId === undefined) {
    return failure('바꿀 id 와 --to <새 id> 를 지정해 주세요.');
  }

  const cardRename: RenameCardResult = await container.cards.rename({
    workspaceRoot: container.workspaceRoot,
    category,
    fromId,
    toId,
  });

  if (!cardRename.ok) {
    return failure(cardRename.message);
  }

  for (const path of cardRename.unreadableFiles) {
    container.logger.warn(`참조를 갱신하지 못했습니다: ${path}`);
  }

  return success(
    `${fromId} → ${toId}${cardRename.rewrittenCount > 0 ? ` (참조 ${cardRename.rewrittenCount}건 갱신)` : ''}`,
    { oldId: fromId, newId: toId, rewritten: cardRename.rewrittenCount },
  );
};

export const buildStoryCards: CommandHandler = async ({ container, args }) => {
  const proposal: BuildStoryCardsProposal = await container.cards.buildFromScenes({
    workspaceRoot: container.workspaceRoot,
  });

  if (flagBoolean(args.flags, 'dry-run')) {
    return success(`카드 구성안 ${proposal.targets.length}건`, proposal);
  }

  const { writtenIds: written, needsIdNames: needsId } = await container.cards.applyBuildTargets(
    container.workspaceRoot,
    proposal.targets,
  );

  return success(describeCardBuild(written.length, needsId), { written, needsId });
};

function describeCardBuild(writtenCount: number, needsId: readonly string[]): string {
  if (needsId.length === 0) {
    return `카드 ${writtenCount}개를 갱신했습니다.`;
  }

  return (
    `카드 ${writtenCount}개를 갱신했습니다. id 를 정할 수 없어 건너뛴 새 카드: ${needsId.join(', ')}. ` +
    'card create 로 --id 를 지정해 만든 뒤 다시 실행해 주세요.'
  );
}

export const createCard: CommandHandler = async ({ container, args }) => {
  const kind: BibleSubjectKind | undefined = cardCategoryFrom(args);
  const name: string | undefined = flagString(args.flags, 'name') ?? args.positionals[1];

  if (kind === undefined) {
    return failure(describeMissingCardCategory('card create'));
  }

  if (name === undefined || name.trim().length === 0) {
    return failure('--name 으로 이름을 지정해 주세요.');
  }

  const cardType: 'character' | 'location' = kind === 'character' ? 'character' : 'location';
  const explicitId: string | undefined = flagString(args.flags, 'id');
  const suggested: string | undefined = explicitId ?? slugify(name);

  if (suggested === undefined) {
    return failure(
      `'${name.trim()}' 에서 id 를 만들 수 없습니다. --id hana 처럼 영문 id 를 주세요 (영소문자·숫자·하이픈).`,
    );
  }

  if (!cardIdPattern.test(suggested)) {
    return failure(`id 는 영소문자·숫자·하이픈만 쓸 수 있습니다: ${suggested}`);
  }

  if (
    explicitId !== undefined &&
    (await container.cards.exists(container.workspaceRoot, cardType, explicitId))
  ) {
    return failure(
      `이미 있는 카드입니다: ${explicitId}. 다른 id 를 주거나 card show ${explicitId} 로 확인하세요.`,
    );
  }

  const id: string = await container.cards.deriveUniqueId(
    container.workspaceRoot,
    cardType,
    suggested,
    suggested,
  );
  const card: Character | LocationBackgroundCard =
    kind === 'character'
      ? createEmptyCharacter(id, name.trim())
      : createEmptyBackground(id, name.trim());
  const uri: StoryUri = await container.cards.write(container.workspaceRoot, card);

  return success(`${id} 카드를 만들었습니다.`, { id, path: (uri as StoryUri).fsPath });
};

export const cardCategoryLabels: Readonly<Record<BibleSubjectKind, string>> = {
  character: '인물',
  background: '배경',
};

export function cardIdFromUnreadableFileName(fileName: string): string {
  return fileName.replace(/\.card$/, '');
}

export interface CardListRow {
  readonly category: BibleSubjectKind;
  readonly id: string;
  readonly name: string | null;
  readonly role: CharacterRole | null;
  readonly error: string | null;
}

export const listCards: CommandHandler = async ({ container, args }) => {
  const requested: string | undefined = args.positionals[0];
  const categories: BibleSubjectKind[] = cardCategories.filter(
    (category) => requested === undefined || category === requested,
  );

  if (categories.length === 0) {
    return failure(
      `카드 종류를 알 수 없습니다: ${requested}\n쓸 수 있는 값: ${cardCategories.join(', ')}`,
    );
  }

  const cards: CardListRow[] = (
    await Promise.all(
      categories.map(async (category) =>
        (await container.cards.list(container.workspaceRoot, category)).map((summary) => ({
          category,
          id: summary.error === undefined ? summary.id : cardIdFromUnreadableFileName(summary.name),
          name: summary.error === undefined ? summary.name : null,
          role: summary.role ?? null,
          error: summary.error ?? null,
        })),
      ),
    )
  ).flat();

  if (cards.length === 0) {
    return success('카드가 없습니다.', { cards: [] });
  }

  return success(
    cards
      .map(
        (card) =>
          `${card.id}\t${card.name ?? `읽을 수 없음: ${card.error}`}\t${cardCategoryLabels[card.category]}`,
      )
      .join('\n'),
    { cards },
  );
};

export const showCard: CommandHandler = async ({ container, args }) => {
  const id: string | undefined = args.positionals[0];

  if (id === undefined) {
    return failure('카드 id 를 지정해 주세요: storyboard card show <id>');
  }

  const reading: CardReading | undefined = await container.cards.read(container.workspaceRoot, id);

  if (reading === undefined) {
    return failure(`카드를 찾을 수 없습니다: ${id}`);
  }

  return success(
    [
      `${reading.card.name} (${reading.card.id}) — ${cardCategoryLabels[reading.category]}`,
      '',
      serializeCard(reading.card).trimEnd(),
    ].join('\n'),
    {
      category: reading.category,
      id: reading.card.id,
      path: (reading.uri as StoryUri).fsPath,
      card: reading.card,
    },
  );
};
