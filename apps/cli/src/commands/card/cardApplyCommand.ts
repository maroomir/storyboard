import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { cardIdPattern } from '@/commands/card/cardArguments';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type {
  CardPendingApplyReport,
  CardPendingResult,
  PendingCardChanges,
  PendingCardSummary,
} from '@storyboard/story-engine';

const originLabels: Readonly<Record<PendingCardSummary['origins'][number], string>> = {
  absorb: '노트',
  interview: '인터뷰',
  studio: '스튜디오',
};

const nothingToApplyMessage: string = '반영할 제안이 없습니다.';

function describeOrigin(origin: PendingCardSummary['origins'][number]): string {
  return originLabels[origin];
}

function describeChanges(changes: PendingCardChanges): string[] {
  return [
    `${changes.slug}  ${changes.path}`,
    ...changes.changes.flatMap((change) => [
      `  ${describeOrigin(change.origin)} · ${change.summary}`,
      ...change.statements.map((line) => `    ${line.facet}${line.key === undefined ? '' : ` ${line.key}`}: ${line.value}`),
    ]),
  ];
}

export class CardApplyCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card apply',
    writesWorkspace: true,
    group: '카드',
    usage: 'card apply [<slug> …]',
    summary: '세션에 남은 카드 제안(노트·인터뷰·스튜디오)을 보여 주고 statements.yaml 에 씁니다 (slug 가 없으면 전부)',
    flags: ['dry-run'],
    examples: ['storyboard card apply elia --dry-run', 'storyboard card apply elia', 'storyboard card apply'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const invalidSlug: string | undefined = args.positionals.find((slug) => !cardIdPattern.test(slug));
    if (invalidSlug !== undefined) {
      return failure(`카드 slug 가 올바르지 않습니다: ${invalidSlug}`);
    }

    const targets: readonly string[] = await this.findTargets(container, args.positionals);
    if (targets.length === 0) {
      return success(nothingToApplyMessage, { cards: [] });
    }

    const previews: readonly PendingCardChanges[] = await this.loadPreviews(container, targets);
    if (flagBoolean(args.flags, 'dry-run')) {
      return success(previews.flatMap(describeChanges).join('\n'), { cards: previews });
    }

    return await this.applyTargets(container, previews);
  }

  private async findTargets(container: CliContainer, requested: readonly string[]): Promise<string[]> {
    const pending: readonly PendingCardSummary[] = await container.cards.listPendingCards(
      container.workspaceRoot,
    );
    const asked: ReadonlySet<string> = new Set(requested);

    return pending.map((card) => card.slug).filter((slug) => asked.size === 0 || asked.has(slug));
  }

  private async loadPreviews(
    container: CliContainer,
    targets: readonly string[],
  ): Promise<PendingCardChanges[]> {
    const previews: PendingCardChanges[] = [];
    for (const slug of targets) {
      const listed: CardPendingResult<PendingCardChanges> = await container.cards.listPending(
        container.workspaceRoot,
        slug,
      );
      if (listed.ok) {
        previews.push(listed.report);
      }
    }

    return previews;
  }

  private async applyTargets(
    container: CliContainer,
    previews: readonly PendingCardChanges[],
  ): Promise<CommandOutcome> {
    const reports: CardPendingApplyReport[] = [];
    for (const preview of previews) {
      const applied: CardPendingResult<CardPendingApplyReport> = await container.cards.applyPending(
        container.workspaceRoot,
        preview.slug,
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
      [
        ...previews.flatMap(describeChanges),
        `✓ 카드 ${previews.length}개에 반영했습니다.`,
        ...heldLines,
        ...failureLines,
      ].join('\n'),
      { cards: previews.map((preview) => preview.slug), reports },
    );
  }
}
