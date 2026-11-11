import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { describeNothingToPromote, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type {
  CardPendingApplyReport,
  CardPendingResult,
  PendingCardSummary,
} from '@storyboard/story-engine';

const originLabels: Readonly<Record<PendingCardSummary['origins'][number], string>> = {
  absorb: '노트에서',
  interview: '인터뷰에서',
  studio: '스튜디오에서',
};

function describeOrigins(summary: PendingCardSummary): string {
  return summary.origins.map((origin) => originLabels[origin]).join('·');
}

export class CardPromoteCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card promote',
    writesWorkspace: true,
    group: '카드',
    usage: 'card promote',
    summary: '노트·인터뷰·스튜디오가 남긴 카드 제안을 반영합니다',
    flags: ['dry-run'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const pending: readonly PendingCardSummary[] = await container.cards.listPendingCards(
      container.workspaceRoot,
    );

    if (pending.length === 0) {
      return success(describeNothingToPromote('no_candidates'), { kind: 'no_candidates' });
    }

    return flagBoolean(args.flags, 'dry-run')
      ? describePromotionPreview(pending)
      : this.applyPending(container, pending);
  }

  private async applyPending(
    container: CliContainer,
    pending: readonly PendingCardSummary[],
  ): Promise<CommandOutcome> {
    const reports: CardPendingApplyReport[] = [];
    for (const card of pending) {
      const applied: CardPendingResult<CardPendingApplyReport> = await container.cards.applyPending(
        container.workspaceRoot,
        card.slug,
      );
      if (applied.ok) {
        reports.push(applied.report);
      }
    }

    const heldLines: readonly string[] = reports
      .flatMap((report) => report.heldByAuthor)
      .map((line) => `  작가가 쓴 줄이라 두었습니다: ${line.facet} ${line.value}`);
    const failureLines: readonly string[] = reports
      .flatMap((report) => report.failures)
      .map((message) => `  적용하지 못했습니다: ${message}`);

    return success(
      [`카드 ${pending.length}개를 갱신했습니다.`, ...heldLines, ...failureLines].join('\n'),
      { cards: pending.map((card) => card.slug), reports },
    );
  }
}

function describePromotionPreview(pending: readonly PendingCardSummary[]): CommandOutcome {
  return success(
    [
      `승격 후보 ${pending.length}건`,
      ...pending.map(
        (card) => `  ${describeOrigins(card)}  ${card.slug} (${card.name}) 변경 ${card.changeCount}건`,
      ),
    ].join('\n'),
    { cards: pending },
  );
}
