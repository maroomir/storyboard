import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { SeedScenesResult } from '@storyboard/story-engine';

export class SceneSeedCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene seed',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene seed',
    summary: '아웃라인에서 씬 시드를 만듭니다',
    flags: ['force'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const seeding: SeedScenesResult = await container.novel.seedScenes({
      workspaceRoot: container.workspaceRoot,
      overwrite: flagBoolean(args.flags, 'force'),
    });

    switch (seeding.kind) {
      case 'seeded':
        return success(`씬 시드 ${seeding.fileNames.length}개를 생성했습니다.`, seeding.fileNames);
      case 'empty_plan':
        return success('아웃라인에 생성할 씬이 없습니다.', []);
      case 'missing_outline':
        return failure(
          '아웃라인(chapters.yaml)이 없습니다. outline generate 를 먼저 실행해 주세요.',
        );
      case 'existing_scenes':
        return failure(
          `씬 파일이 이미 ${seeding.existingCount}개 있습니다. 덮어쓰려면 --force 를 주세요.`,
        );
      case 'failed':
        return failure(seeding.message);
    }
  }
}
