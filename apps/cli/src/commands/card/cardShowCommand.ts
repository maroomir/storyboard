import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { cardCategoryLabels } from '@/commands/card/cardViews';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { CardReading, CardViewReading } from '@storyboard/story-app';
import type {
  CardPendingResult,
  CardSessionSummary,
  ElementBundle,
} from '@storyboard/story-engine';
import type { ElementKind, NarratorCard, Statement, StoryUri } from '@storyboard/story-model';
import { toNarratorData } from '@/commands/card/narratorViews';
import { posix } from 'node:path';

const sessionKindLabels: Readonly<Record<CardSessionSummary['kind'], string>> = {
  studio: '스튜디오',
  interview: '인터뷰',
  absorb: '노트 흡수',
};

type CardKind = Exclude<ElementKind, 'scene'>;

const cardKindLabels: Readonly<Record<CardKind, string>> = {
  ...cardCategoryLabels,
  narrator: '서술자',
};

interface StatementLineOptions {
  readonly shouldShowSources: boolean;
}

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
    const bundle: ElementBundle | undefined = await container.cards.readBundle(
      container.workspaceRoot,
      slug,
    );
    if (bundle === undefined) {
      return failure(`카드를 찾을 수 없습니다: ${slug}`);
    }

    const kind: CardKind = bundle.header.kind as CardKind;
    const reading: CardViewReading = await container.cards.readView(
      container.workspaceRoot,
      kind,
      posix.basename(bundle.path),
    );
    if (!reading.ok) {
      return failure(reading.message);
    }

    const statementLines: string[] = await this.describeStatementLines(container, bundle.statements, {
      shouldShowSources: false,
    });
    return success(
      [
        `${reading.view.name} (${slug}) — ${cardKindLabels[kind]}`,
        ...(reading.view.facts.length > 0 ? [reading.view.facts.join(' · ')] : []),
        '',
        ...(statementLines.length > 0 ? statementLines : ['(진술 없음)']),
      ].join('\n'),
      { ...(await this.describeCardData(container, kind, slug)), statements: bundle.statements },
    );
  }

  private async describeCardData(
    container: CliContainer,
    kind: CardKind,
    slug: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (kind === 'narrator') {
      const narrator: NarratorCard | undefined = (
        await container.cards.listNarrators(container.workspaceRoot)
      ).get(slug);
      return narrator === undefined ? {} : toNarratorData(narrator);
    }

    const reading: CardReading | undefined = await container.cards.read(container.workspaceRoot, slug);
    return reading === undefined
      ? {}
      : {
          category: reading.category,
          id: reading.card.id,
          path: (reading.uri as StoryUri).fsPath,
          card: reading.card,
        };
  }

  private async showSources(container: CliContainer, slug: string): Promise<CommandOutcome> {
    const bundle: ElementBundle | undefined = await container.cards.readBundle(
      container.workspaceRoot,
      slug,
    );
    if (bundle === undefined) {
      return failure(`카드를 찾을 수 없습니다: ${slug}`);
    }

    const lines: string[] = await this.describeStatementLines(container, bundle.statements, {
      shouldShowSources: true,
    });

    return success([`${bundle.path}/statements.yaml`, ...lines].join('\n'), {
      path: bundle.path,
      statements: bundle.statements,
    });
  }

  private async describeStatementLines(
    container: CliContainer,
    statements: readonly Statement[],
    options: StatementLineOptions,
  ): Promise<string[]> {
    const lines: string[] = [];
    for (const [index, statement] of statements.entries()) {
      const source: string = options.shouldShowSources ? `  ← ${describeSource(statement)}` : '';
      lines.push(`${String(index + 1).padStart(3)}  ${await this.describeSlot(container, statement)}: ${statement.value}${source}`);
    }
    return lines;
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
