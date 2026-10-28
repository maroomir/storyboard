import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { cardCategoryLabels } from '@/commands/card/cardViews';
import { failure, success } from '@/commands/outcomes';
import type { CardReading } from '@storyboard/story-app';
import { serializeCard, type StoryUri } from '@storyboard/story-model';

export class CardShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card show',
    group: '카드와 정전',
    usage: 'card show <id>',
    summary: '카드 하나의 내용을 봅니다 (인물에서 먼저 찾고 배경에서 찾습니다)',
    examples: ['storyboard card show hana'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const id: string | undefined = args.positionals[0];

    if (id === undefined) {
      return failure('카드 id 를 지정해 주세요: storyboard card show <id>');
    }

    const reading: CardReading | undefined = await container.cards.read(
      container.workspaceRoot,
      id,
    );

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
  }
}
