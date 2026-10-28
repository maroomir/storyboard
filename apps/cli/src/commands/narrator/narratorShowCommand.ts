import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeCard, toNarratorData } from '@/commands/narrator/narratorViews';
import type { NarratorCard } from '@storyboard/story-model';
import { success, failure } from '@/commands/outcomes';

export class NarratorShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'narrator show',
    group: '기획',
    usage: 'narrator show <id>',
    summary: '서술자 하나의 인칭·지식 경계·시제·목소리를 봅니다',
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const id: string | undefined = args.positionals[0];

    if (id === undefined) {
      return failure('서술자 id 를 지정해 주세요.');
    }

    const narrator: NarratorCard | undefined = (
      await container.cards.listNarrators(container.workspaceRoot)
    ).get(id);

    if (!narrator) {
      return failure(`서술자 '${id}' 를 찾을 수 없습니다.`);
    }

    return success(
      [
        `${narrator.name} (${narrator.id})`,
        describeCard(narrator),
        ...(narrator.voice && narrator.voice.length > 0
          ? [`목소리: ${narrator.voice.join(' / ')}`]
          : []),
      ].join('\n'),
      toNarratorData(narrator),
    );
  }
}
