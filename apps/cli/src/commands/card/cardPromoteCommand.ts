import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeNoteConflicts } from '@/commands/card/cardViews';
import { flagBoolean } from '@/cliArguments';
import { describeNothingToPromote, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type {
  PrepareNoteCandidatePromotionResult,
  PromoteNoteCandidatesResult,
} from '@storyboard/story-engine';
import type { MergedNoteCardCandidate } from '@storyboard/story-model';

interface PromotionCandidates {
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
    summary: '노트·인터뷰에서 나온 카드 후보를 반영합니다',
    flags: ['dry-run'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const preparedNotes: PrepareNoteCandidatePromotionResult =
      await container.notes.prepareCandidatePromotion(container.workspaceRoot);

    if (preparedNotes.kind !== 'ready') {
      return success(describeNothingToPromote(preparedNotes.kind), { kind: preparedNotes.kind });
    }

    const candidates: PromotionCandidates = collectPromotionCandidates(preparedNotes);

    return flagBoolean(args.flags, 'dry-run')
      ? describePromotionPreview(candidates)
      : this.promoteCandidates(container, candidates);
  }

  private async promoteCandidates(
    container: CliContainer,
    { noteCandidates, conflictedCards, conflictLines }: PromotionCandidates,
  ): Promise<CommandOutcome> {
    const noteResult: PromoteNoteCandidatesResult | undefined =
      noteCandidates.length > 0
        ? await container.notes.promoteCandidates(container.workspaceRoot, noteCandidates)
        : undefined;
    const updatedCardCount: number = noteResult?.updatedCardIds.length ?? 0;

    return success(
      [`카드 ${updatedCardCount}개를 갱신했습니다.`, ...conflictLines].join('\n'),
      { notes: noteResult ?? null, conflicts: conflictedCards },
    );
  }
}

function collectPromotionCandidates(
  preparedNotes: PrepareNoteCandidatePromotionResult,
): PromotionCandidates {
  const noteCandidates: readonly MergedNoteCardCandidate[] =
    preparedNotes.kind === 'ready' ? preparedNotes.candidates : [];
  const conflictedCards: MergedNoteCardCandidate[] = [
    ...noteCandidates,
    ...(preparedNotes.kind === 'ready' ? preparedNotes.heldCards : []),
  ].filter((candidate) => candidate.conflicts.length > 0);

  return {
    noteCandidates,
    conflictedCards,
    conflictLines: describeNoteConflicts(conflictedCards),
  };
}

function describeCandidateOrigin(candidate: MergedNoteCardCandidate): string {
  const isInterview = (location: string): boolean => location.startsWith('interview:');

  if (candidate.locations.every(isInterview)) {
    return '인터뷰에서';
  }

  return candidate.locations.some(isInterview) ? '노트·인터뷰에서' : '노트에서';
}

function describePromotionPreview({
  noteCandidates,
  conflictedCards,
  conflictLines,
}: PromotionCandidates): CommandOutcome {
  return success(
    [
      `승격 후보 ${noteCandidates.length}건`,
      ...noteCandidates.map(
        (candidate) =>
          `  ${describeCandidateOrigin(candidate)}  ${candidate.cardId} (${candidate.name}) 변경 ${candidate.changes.length}건 ← ${candidate.locations.join(', ')}`,
      ),
      ...conflictLines,
    ].join('\n'),
    { notes: noteCandidates, conflicts: conflictedCards },
  );
}
