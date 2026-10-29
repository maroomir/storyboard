import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeNoteConflicts } from '@/commands/card/cardViews';
import { flagBoolean } from '@/cliArguments';
import { describeNothingToPromote, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type {
  PrepareCardCandidatePromotionResult,
  PrepareNoteCandidatePromotionResult,
  PromoteCardCandidatesResult,
  PromoteNoteCandidatesResult,
} from '@storyboard/story-engine';
import type { CardCandidateItem, MergedNoteCardCandidate } from '@storyboard/story-model';

interface PromotionCandidates {
  readonly draftItems: readonly CardCandidateItem[];
  readonly noteCandidates: readonly MergedNoteCardCandidate[];
  readonly conflictedCards: readonly MergedNoteCardCandidate[];
  readonly conflictLines: readonly string[];
}

export class CardPromoteCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card promote',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: 'card promote',
    summary: '초안과 노트에서 나온 카드 후보를 반영합니다',
    flags: ['dry-run'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
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

    const candidates: PromotionCandidates = collectPromotionCandidates(prepared, preparedNotes);

    return flagBoolean(args.flags, 'dry-run')
      ? describePromotionPreview(candidates)
      : this.promoteCandidates(container, candidates);
  }

  private async promoteCandidates(
    container: CliContainer,
    { draftItems, noteCandidates, conflictedCards, conflictLines }: PromotionCandidates,
  ): Promise<CommandOutcome> {
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
  }
}

function collectPromotionCandidates(
  prepared: PrepareCardCandidatePromotionResult,
  preparedNotes: PrepareNoteCandidatePromotionResult,
): PromotionCandidates {
  const noteCandidates: readonly MergedNoteCardCandidate[] =
    preparedNotes.kind === 'ready' ? preparedNotes.candidates : [];
  const conflictedCards: MergedNoteCardCandidate[] = [
    ...noteCandidates,
    ...(preparedNotes.kind === 'ready' ? preparedNotes.heldCards : []),
  ].filter((candidate) => candidate.conflicts.length > 0);

  return {
    draftItems: prepared.kind === 'ready' ? prepared.items : [],
    noteCandidates,
    conflictedCards,
    conflictLines: describeNoteConflicts(conflictedCards),
  };
}

function describePromotionPreview({
  draftItems,
  noteCandidates,
  conflictedCards,
  conflictLines,
}: PromotionCandidates): CommandOutcome {
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
