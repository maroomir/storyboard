import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { describeRenumbering } from '@/commands/scene/sceneMoveCommand';
import { failure, success } from '@/commands/outcomes';
import type { RemoveSceneResult } from '@storyboard/story-engine';

export class SceneRemoveCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene remove',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene remove <씬>',
    summary: '씬 번들과 그 초안·판본을 지우고 뒤 씬들의 번호를 다시 매깁니다 (git 으로 되돌릴 수 있음)',
    examples: ['storyboard scene remove 003-detour'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const scene: string | undefined = args.positionals[0];
    if (scene === undefined) {
      return failure('지울 씬을 주세요: storyboard scene remove <씬>');
    }

    const removed: RemoveSceneResult = await container.drafts.removeScene({
      workspaceRoot: container.workspaceRoot,
      scene,
    });

    return removed.ok
      ? success([`✓ ${removed.stem} 를 지웠습니다.`, ...describeRenumbering(removed.renamed)].join('\n'), removed)
      : failure(removed.message, removed);
  }
}
