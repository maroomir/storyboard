import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeCard, toNarratorData } from '@/commands/narrator/narratorViews';
import type { NarratorCard } from '@storyboard/story-model';
import { success } from '@/commands/outcomes';

export class NarratorListCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'narrator list',
    group: '기획',
    usage: 'narrator list',
    summary: '서술자 카드를 봅니다 (없으면 작품 계약의 시점 하나가 모든 씬에 적용됩니다)',
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const narrators: NarratorCard[] = [
      ...(await container.cards.listNarrators(container.workspaceRoot)).values(),
    ];

    if (narrators.length === 0) {
      return success('서술자 카드가 없습니다. 작품 계약의 시점 하나가 모든 씬에 적용됩니다.', {
        narrators: [],
      });
    }

    const lines: string[] = narrators.map(
      (card) => `${card.id}\t${card.name}\t${describeCard(card)}`,
    );

    return success(lines.join('\n'), { narrators: narrators.map(toNarratorData) });
  }
}
