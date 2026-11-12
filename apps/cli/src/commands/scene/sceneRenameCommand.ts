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
    usage: 'scene rename <씬> --to <slug>',
    summary: '씬 이름(slug)을 바꾸고 번호 붙은 폴더·초안과 참조를 함께 옮깁니다 (씬은 번호-slug·번호·slug, 번호는 그대로)',
    flags: ['to'],
    examples: ['storyboard scene rename night-market --to moon-market', 'storyboard scene rename 3 --to moon-market'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const scene: string | undefined = args.positionals[0];
    const to: string | undefined = flagString(args.flags, 'to');

    if (scene === undefined || to === undefined) {
      return failure('바꿀 씬과 --to <새 slug> 를 지정해 주세요.');
    }

    const sceneRename: RenameSceneResult = await container.drafts.renameScene({
      workspaceRoot: container.workspaceRoot,
      scene,
      to,
    });

    if (!sceneRename.ok) {
      return failure(sceneRename.message);
    }

    return success(
      `${sceneRename.fromStem} → ${sceneRename.toStem} (옮긴 파일 ${sceneRename.movedFiles.length}개, 고친 파일 ${sceneRename.rewrittenFiles.length}개).`,
      sceneRename,
    );
  }
}
