import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { flagBoolean, flagString } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';
import type { SceneTargetLengthScenes, SetSceneTargetLengthResult } from '@storyboard/story-engine';

export class SceneSetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene set',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene set <씬> | --all --target-words <n>',
    summary: '씬 카드의 목표 분량(자)을 정합니다 (--all 은 모든 씬, 작품 계약의 목표 분량은 project set)',
    flags: ['all', 'target-words'],
    examples: ['storyboard scene set 001-first-meeting --target-words 20000', 'storyboard scene set --all --target-words 20000'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const stem: string | undefined = sceneStemFrom(args);
    const scenes: SceneTargetLengthScenes | undefined = flagBoolean(args.flags, 'all')
      ? 'all'
      : stem === undefined
        ? undefined
        : [stem];
    const rawTargetWords: string | undefined = flagString(args.flags, 'target-words');
    if (scenes === undefined || rawTargetWords === undefined) {
      return failure('정할 씬(또는 --all)과 --target-words <n> 을 지정해 주세요.');
    }

    const targetWordCount: number = Number(rawTargetWords);
    const isPositiveInteger: boolean = Number.isInteger(targetWordCount) && targetWordCount > 0;
    if (!isPositiveInteger) {
      return failure(`--target-words 는 양의 정수여야 합니다: ${rawTargetWords}`);
    }

    const written: SetSceneTargetLengthResult = await container.drafts.setSceneTargetLength({
      workspaceRoot: container.workspaceRoot,
      scenes,
      targetWordCount,
    });
    if (!written.ok) {
      return failure(written.message);
    }

    return success(
      `씬 ${written.stems.length}개의 목표 분량을 약 ${targetWordCount.toLocaleString('en-US')}자로 정했습니다.`,
      written,
    );
  }
}
