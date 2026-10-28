import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import type { RemoveNarratorCardResult } from '@storyboard/story-engine';
import { success, failure } from '@/commands/outcomes';

export class NarratorRemoveCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'narrator remove',
    writesWorkspace: true,
    group: '기획',
    usage: 'narrator remove <id>',
    summary: '서술자 카드를 지웁니다',
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const id: string | undefined = args.positionals[0];

    if (id === undefined) {
      return failure('서술자 id 를 지정해 주세요.');
    }

    const removed: RemoveNarratorCardResult = await container.cards.removeNarrator(
      container.workspaceRoot,
      id,
    );

    if (!removed.ok) {
      return failure(`서술자 '${id}' 를 찾을 수 없습니다.`);
    }

    return success(
      `narrator/${id}.card 를 지웠습니다. 이 id 를 참조하는 씬이 남아 있으면 doctor 가 알려 줍니다.`,
      { id },
    );
  }
}
