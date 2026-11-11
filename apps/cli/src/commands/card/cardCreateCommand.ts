import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { type CardKind, type CommandSpec, cardKinds } from '@/commands/catalog';
import { cardIdPattern } from '@/commands/card/cardArguments';
import { describeLineDiff } from '@/commands/card/cardEditCommand';
import { buildCard, narratorIdPattern, type BuildCardResult } from '@/commands/card/narratorCardForm';
import { toNarratorData } from '@/commands/card/narratorViews';
import { flagBoolean, flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type {
  CreateNarratorCardResult,
  ElementBundle,
  StudioCreateResult,
} from '@storyboard/story-engine';
import { listStatementFacetsOf, type StoryUri } from '@storyboard/story-model';

type DescribedKind = Exclude<CardKind, 'narrator'>;

function isCardKind(value: string | undefined): value is CardKind {
  return cardKinds.some((kind) => kind === value);
}

function describeEditOutcome(
  slug: string,
  edit: Extract<StudioCreateResult, { readonly ok: true }>['edit'],
): string[] {
  if (!edit.ok) {
    return [`설명을 카드에 채우지 못했습니다: ${edit.message}`];
  }
  if (edit.kind === 'proposed') {
    return [`제안: ${edit.summary}`, ...describeLineDiff(edit.diff)];
  }

  return edit.kind === 'applied' ? [`✓ ${edit.summary}`] : [`스튜디오: ${edit.message}`];
}

export class CardCreateCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card create',
    writesWorkspace: true,
    group: '카드',
    usage: `card create <${cardKinds.join('|')}> "<설명>" [--name <이름>] [--id <slug>]`,
    summary:
      '설명에서 카드 번들을 만들고 채웁니다 (빈 칸과 다음 명령을 알림, --dry-run 은 읽어 낸 줄만 보여 줌). 서술자는 --person 등으로',
    flags: ['name', 'id', 'dry-run', 'propose', 'person', 'knowledge', 'tense', 'focal', 'voice'],
    examples: [
      'storyboard card create character "무뚝뚝한 열일곱 살 궁수 엘리아" --id elia',
      'storyboard card create background "자정에 닫는 항구 야시장" --dry-run',
      'storyboard card create narrator hana-first --person first --focal hana',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const kind: string | undefined = args.positionals[0];
    if (!isCardKind(kind)) {
      return failure(`카드 종류를 지정해 주세요: storyboard card create <${cardKinds.join('|')}> "<설명>"`);
    }

    return kind === 'narrator'
      ? await this.createNarrator(container, args.positionals[1], args.flags)
      : await this.createDescribed(container, kind, args.positionals[1], args.flags);
  }

  private async createDescribed(
    container: CliContainer,
    kind: DescribedKind,
    description: string | undefined,
    flags: CommandContext['args']['flags'],
  ): Promise<CommandOutcome> {
    if (description === undefined || description.trim().length === 0) {
      return failure(`카드를 설명해 주세요: storyboard card create ${kind} "<설명>"`);
    }

    const name: string | undefined = flagString(flags, 'name')?.trim() || undefined;
    const slug: string | undefined = flagString(flags, 'id');
    if (slug !== undefined && !cardIdPattern.test(slug)) {
      return failure(`slug 는 영소문자·숫자·하이픈만 쓸 수 있습니다: ${slug}`);
    }

    const isPreview: boolean = flagBoolean(flags, 'dry-run');
    const created: StudioCreateResult = await container.studio.create({
      workspaceRoot: container.workspaceRoot,
      kind,
      ...(slug === undefined ? {} : { slug }),
      ...(name === undefined ? {} : { name }),
      description,
      shouldPropose: flagBoolean(flags, 'propose'),
      isPreview,
    });
    if (!created.ok) {
      return failure(created.message, created);
    }

    return isPreview
      ? success(['미리보기입니다. 아무것도 쓰지 않았습니다.', ...describeEditOutcome(created.key, created.edit)].join('\n'), created)
      : success(await this.describeCreated(container, kind, created), created);
  }

  private async describeCreated(
    container: CliContainer,
    kind: DescribedKind,
    created: Extract<StudioCreateResult, { readonly ok: true }>,
  ): Promise<string> {
    const bundle: ElementBundle | undefined = await container.cards.readBundle(
      container.workspaceRoot,
      created.key,
    );
    const filled: ReadonlySet<string> = new Set((bundle?.statements ?? []).map((line) => line.facet));
    const empty: readonly string[] = listStatementFacetsOf(kind)
      .map((row) => row.id)
      .filter((facet) => !filled.has(facet));

    return [
      `✓ ${(created.uri as StoryUri).fsPath} 를 만들었습니다 (${created.key}).`,
      ...describeEditOutcome(created.key, created.edit),
      ...(empty.length === 0 ? [] : [`비어 있음: ${empty.join(', ')}`]),
      `다음: storyboard card interview ${created.key} 또는 storyboard card set ${created.key} <facet> "<값>"`,
    ].join('\n');
  }

  private async createNarrator(
    container: CliContainer,
    positionalSlug: string | undefined,
    flags: CommandContext['args']['flags'],
  ): Promise<CommandOutcome> {
    const slug: string | undefined = flagString(flags, 'id') ?? positionalSlug;
    if (slug === undefined || !narratorIdPattern.test(slug)) {
      return failure('서술자 slug 는 영소문자·숫자·하이픈만 쓸 수 있습니다 (예: hana-first).');
    }

    const card: BuildCardResult = buildCard(slug, flags);
    if (!card.ok) {
      return card.outcome;
    }

    const created: CreateNarratorCardResult = await container.cards.createNarrator(
      container.workspaceRoot,
      card.card,
    );
    if (!created.ok) {
      return failure(`이미 있습니다: narrator/${slug}.card`);
    }

    return success(
      `narrator/${slug}.card 를 만들었습니다. 씬이나 장의 서술자로 이 slug 를 쓰면 그 씬에 적용됩니다.`,
      { ...toNarratorData(card.card), path: (created.uri as StoryUri).fsPath },
    );
  }
}
