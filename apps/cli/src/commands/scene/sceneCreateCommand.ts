import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { CreateSceneResult } from '@storyboard/story-engine';
import { slugify, type StoryUri } from '@storyboard/story-model';

export class SceneCreateCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene create',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene create --name <text>',
    summary: '다음 번호로 씬 카드를 만듭니다',
    flags: ['name'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const name: string | undefined = flagString(args.flags, 'name') ?? args.positionals[0];

    if (name === undefined || name.trim().length === 0) {
      return failure('--name 으로 씬 이름을 지정해 주세요.');
    }

    const slug: string | undefined = slugify(name);
    const sceneCreation: CreateSceneResult = await container.drafts.createScene({
      workspaceRoot: container.workspaceRoot,
      ...(slug === undefined ? {} : { slug }),
    });

    if (!sceneCreation.ok) {
      return failure(sceneCreation.message);
    }

    return success(`${sceneCreation.stem}.card 를 만들었습니다.`, {
      stem: sceneCreation.stem,
      path: (sceneCreation.uri as StoryUri).fsPath,
    });
  }
}
