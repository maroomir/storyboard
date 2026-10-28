import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { RenameSceneResult } from '@storyboard/story-engine';

export class SceneRenameCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene rename',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene rename <stem> --to <stem>',
    summary: '씬 이름·번호를 바꾸고 초안·기억·정전의 참조를 함께 옮깁니다',
    flags: ['to'],
    examples: ['storyboard scene rename 03-night-market --to 04-night-market'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const fromStem: string | undefined = args.positionals[0];
    const toStem: string | undefined = flagString(args.flags, 'to');

    if (fromStem === undefined || toStem === undefined) {
      return failure('바꿀 씬과 --to <새 이름> 을 지정해 주세요.');
    }

    const sceneRename: RenameSceneResult = await container.drafts.renameScene({
      workspaceRoot: container.workspaceRoot,
      fromStem,
      toStem,
    });

    if (!sceneRename.ok) {
      return failure(sceneRename.message);
    }

    const orderNote: '' | ' 번호가 바뀌었으므로 아웃라인의 자리와 장 배정도 새 번호를 따릅니다.' =
      sceneRename.hasOrderChanged
        ? ' 번호가 바뀌었으므로 아웃라인의 자리와 장 배정도 새 번호를 따릅니다.'
        : '';

    return success(
      `${sceneRename.fromStem} → ${sceneRename.toStem} (옮긴 파일 ${sceneRename.movedFiles.length}개, 고친 파일 ${sceneRename.rewrittenFiles.length}개).${orderNote}`,
      sceneRename,
    );
  }
}
