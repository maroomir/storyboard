import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { parseSceneOrders } from '@/commands/state/sceneOrderRanges';
import { failure, success } from '@/commands/outcomes';
import { formatSceneOrderRanges } from '@storyboard/story-model';

export class StateResealCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'state reseal',
    writesWorkspace: true,
    group: '초안',
    usage: 'state reseal [<씬 범위>]',
    summary:
      '카드를 고쳤지만 지금 초안이 맞다고 보고 이야기 상태 원장을 다시 봉인합니다 (범위를 비우면 낡은 씬 전부)',
    examples: ['storyboard state reseal', 'storyboard state reseal 5-32'],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const rawOrders: string | undefined = args.positionals[0];
    const sceneOrders: readonly number[] | undefined =
      rawOrders === undefined ? undefined : parseSceneOrders(rawOrders);

    if (rawOrders !== undefined && sceneOrders === undefined) {
      return failure(
        `씬 범위를 알아볼 수 없습니다: ${rawOrders}\n  5 · 5-8 · 5,7,9 처럼 적어 주세요.`,
      );
    }

    const resealed: readonly number[] = await container.workspace.resealStoryState(
      container.workspaceRoot,
      sceneOrders,
    );

    return success(
      resealed.length === 0
        ? '다시 봉인할 낡은 항목이 없습니다.'
        : `씬 ${formatSceneOrderRanges(resealed)}의 원장 항목을 지금의 카드·씬으로 다시 봉인했습니다.`,
      { sceneOrders: resealed },
    );
  }
}
