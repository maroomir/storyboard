import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { type CommandSpec, cardCategories } from '@/commands/catalog';
import {
  cardCategoryFrom,
  cardIdPattern,
  describeMissingCardCategory,
} from '@/commands/card/cardArguments';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import {
  createEmptyCard,
  slugify,
  type BibleSubjectKind,
  type StoryUri,
} from '@storyboard/story-model';
import type { CreateCardResult } from '@storyboard/story-engine';

export class CardCreateCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card create',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: `card create <${cardCategories.join('|')}> --name <text>`,
    summary: '빈 인물·배경 카드를 만듭니다',
    flags: ['name', 'id'],
    examples: [
      'storyboard card create character --name "서진아" --id seo-jina',
      'storyboard card create background --name "Night Market"',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
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

    const created: CreateCardResult = await container.cards.create({
      workspaceRoot: container.workspaceRoot,
      cardType,
      id: suggested,
      whenIdIsTaken: explicitId === undefined ? 'number-it' : 'refuse',
      buildCard: (id) => createEmptyCard(cardType, id, name.trim()),
    });

    if (!created.ok) {
      return failure(
        `이미 있는 카드입니다: ${created.id}. 다른 id 를 주거나 card show ${created.id} 로 확인하세요.`,
      );
    }

    const id: string = created.id;
    const uri: StoryUri = created.uri;

    return success(`${id} 카드를 만들었습니다.`, { id, path: (uri as StoryUri).fsPath });
  }
}
