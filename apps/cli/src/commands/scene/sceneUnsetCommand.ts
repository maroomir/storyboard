import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { sceneUnsetFields, type SceneUnsetField } from '@/commands/catalog';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import { sceneStemFrom } from '@/commands/sceneArguments';
import type { SceneTargetLengthScenes, SetSceneTargetLengthResult } from '@storyboard/story-engine';

export class SceneUnsetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'scene unset',
    writesWorkspace: true,
    group: '씬',
    usage: `scene unset <씬> | --all <${sceneUnsetFields.join('|')}>`,
    summary: '씬 카드의 목표 분량을 지웁니다 (본문의 [목표 분량]이나 씬 개요 길이로 정한 값이 쓰입니다)',
    flags: ['all'],
    examples: ['storyboard scene unset 001-first-meeting target-words', 'storyboard scene unset --all target-words'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const isAll: boolean = flagBoolean(args.flags, 'all');
    const field: string | undefined = args.positionals[isAll ? 0 : 1];
    const stem: string | undefined = sceneStemFrom(args);
    const scenes: SceneTargetLengthScenes | undefined = isAll ? 'all' : stem === undefined ? undefined : [stem];
    const isKnownField: boolean = sceneUnsetFields.includes(field as SceneUnsetField);
    if (scenes === undefined || !isKnownField) {
      return failure(`지울 씬(또는 --all)과 항목(${sceneUnsetFields.join(', ')})을 지정해 주세요.`);
    }

    const written: SetSceneTargetLengthResult = await container.drafts.setSceneTargetLength({
      workspaceRoot: container.workspaceRoot,
      scenes,
      targetWordCount: undefined,
    });
    if (!written.ok) {
      return failure(written.message);
    }

    return success(`씬 ${written.stems.length}개의 목표 분량을 지웠습니다.`, written);
  }
}
