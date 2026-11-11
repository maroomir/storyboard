import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { MoveSceneResult, SceneStemChange } from '@storyboard/story-engine';

export function describeRenumbering(renamed: readonly SceneStemChange[]): string[] {
  return renamed.map((change) => `  ${change.fromStem} → ${change.toStem}`);
}

export class SceneMoveCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene move',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene move <씬> [--after <씬>]',
    summary: '씬을 다른 씬 바로 뒤로 옮깁니다 (--after 가 없으면 맨 앞). 폴더와 초안 번호를 다시 매깁니다',
    flags: ['after'],
    examples: ['storyboard scene move rooftop --after 5', 'storyboard scene move 007-letter'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const scene: string | undefined = args.positionals[0];
    if (scene === undefined) {
      return failure('옮길 씬을 주세요: storyboard scene move <씬> --after <씬>');
    }

    const after: string | undefined = flagString(args.flags, 'after');
    const moved: MoveSceneResult = await container.drafts.moveScene({
      workspaceRoot: container.workspaceRoot,
      scene,
      ...(after === undefined ? {} : { after }),
    });

    if (!moved.ok) {
      return failure(moved.message, moved);
    }

    return success(
      [
        moved.renamed.length === 0 ? `${moved.stem} 은 이미 그 자리입니다.` : `✓ ${moved.stem} 로 옮겼습니다.`,
        ...describeRenumbering(moved.renamed),
      ].join('\n'),
      moved,
    );
  }
}
