import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { cardCategoryLabels } from '@/commands/card/cardViews';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { CardReading } from '@storyboard/story-app';
import type {
  CardPendingResult,
  CardSessionSummary,
  ElementBundle,
} from '@storyboard/story-engine';
import {
  serializeCard,
  type NarratorCard,
  type Statement,
  type StoryUri,
} from '@storyboard/story-model';
import { describeCard, toNarratorData } from '@/commands/card/narratorViews';

const sessionKindLabels: Readonly<Record<CardSessionSummary['kind'], string>> = {
  studio: '스튜디오',
  interview: '인터뷰',
  absorb: '노트 흡수',
};

function describeSource(statement: Statement): string {
  const { origin, command, session } = statement.source;
  return [origin, command, session].filter((part): part is string => part !== undefined).join(' · ');
}

export class CardShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card show',
    group: '카드',
    usage: 'card show <slug> [--sources | --history]',
    summary: '카드 하나의 내용을 봅니다 (--sources 는 줄마다의 출처, --history 는 세션 기록)',
    flags: ['sources', 'history'],
    examples: ['storyboard card show hana', 'storyboard card show hana --sources'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const slug: string | undefined = args.positionals[0];
    if (slug === undefined) {
      return failure('카드 slug 를 지정해 주세요: storyboard card show <slug>');
    }

    if (flagBoolean(args.flags, 'sources')) {
      return await this.showSources(container, slug);
    }

    return flagBoolean(args.flags, 'history')
      ? await this.showHistory(container, slug)
      : await this.showCard(container, slug);
  }

  private async showCard(container: CliContainer, slug: string): Promise<CommandOutcome> {
    const reading: CardReading | undefined = await container.cards.read(container.workspaceRoot, slug);
    if (reading === undefined) {
      return await this.showNarrator(container, slug);
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
  }

  private async showNarrator(container: CliContainer, slug: string): Promise<CommandOutcome> {
    const narrator: NarratorCard | undefined = (
      await container.cards.listNarrators(container.workspaceRoot)
    ).get(slug);
    if (narrator === undefined) {
      return failure(`카드를 찾을 수 없습니다: ${slug}`);
    }

    return success(
      [
        `${narrator.name} (${narrator.id}) — 서술자`,
        describeCard(narrator),
        ...(narrator.voice && narrator.voice.length > 0 ? [`목소리: ${narrator.voice.join(' / ')}`] : []),
      ].join('\n'),
      toNarratorData(narrator),
    );
  }

  private async showSources(container: CliContainer, slug: string): Promise<CommandOutcome> {
    const bundle: ElementBundle | undefined = await container.cards.readBundle(
      container.workspaceRoot,
      slug,
    );
    if (bundle === undefined) {
      return failure(`카드를 찾을 수 없습니다: ${slug}`);
    }

    const lines: string[] = [];
    for (const [index, statement] of bundle.statements.entries()) {
      lines.push(`${String(index + 1).padStart(3)}  ${await this.describeSlot(container, statement)}: ${statement.value}  ← ${describeSource(statement)}`);
    }

    return success([`${bundle.path}/statements.yaml`, ...lines].join('\n'), {
      path: bundle.path,
      statements: bundle.statements,
    });
  }

  private async describeSlot(container: CliContainer, statement: Statement): Promise<string> {
    const about: string | undefined =
      statement.about === undefined
        ? undefined
        : ((await container.cards.slugOfElement(container.workspaceRoot, statement.about)) ??
          statement.about);

    return [statement.facet, statement.key, about === undefined ? undefined : `→${about}`]
      .filter((part): part is string => part !== undefined)
      .join(' ');
  }

  private async showHistory(container: CliContainer, slug: string): Promise<CommandOutcome> {
    const history: CardPendingResult<readonly CardSessionSummary[]> = await container.cards.listHistory(
      container.workspaceRoot,
      slug,
    );
    if (!history.ok) {
      return failure(history.message);
    }
    if (history.report.length === 0) {
      return success(`${slug} 의 세션 기록이 없습니다.`, { sessions: [] });
    }

    return success(
      history.report
        .map(
          (session) =>
            `${session.updatedAt}  ${sessionKindLabels[session.kind]}  ${session.title}${session.pendingCount > 0 ? `  (제안 ${session.pendingCount}건 대기)` : ''}`,
        )
        .join('\n'),
      { sessions: history.report },
    );
  }
}
