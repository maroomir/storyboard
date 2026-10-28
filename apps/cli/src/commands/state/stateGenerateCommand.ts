import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { parseSceneOrders } from '@/commands/state/sceneOrderRanges';
import { flagBoolean } from '@/cliArguments';
import { failure, success } from '@/commands/outcomes';
import type { GenerateStoryStateResult } from '@storyboard/story-engine';

export class StateGenerateCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'state generate',
    writesWorkspace: true,
    group: '초안',
    usage: 'state generate [<씬 범위>]',
    summary:
      '기존 초안에서 이야기 상태 원장을 세웁니다 (원장에 없는 씬만, --force 로 적은 씬을 다시)',
    flags: ['force'],
    examples: ['storyboard state generate', 'storyboard state generate 1-12 --force'],
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

    const storyStateGeneration: GenerateStoryStateResult =
      await container.drafts.generateStoryState({
        workspaceRoot: container.workspaceRoot,
        ...(sceneOrders === undefined ? {} : { sceneOrders }),
        force: flagBoolean(args.flags, 'force'),
        shouldPause: container.pauseRequests.watch(),
        onProgress: (progress) => {
          container.progress.update({
            line: `${progress.current}/${progress.total} ${progress.stem} · 원장 기록`,
            unit: { current: progress.current, total: progress.total, label: progress.stem },
            step: '원장 기록',
          });
        },
      });

    const { recorded, kept, withoutDraft, failures, pausedWithRemaining } = storyStateGeneration;
    const summary: string =
      `원장에 씬 ${recorded.length}개를 기록했습니다` +
      (kept.length > 0 ? `, ${kept.length}개는 이미 있어 그대로 둡니다` : '') +
      (withoutDraft.length > 0 ? `, 초안 없는 씬 ${withoutDraft.length}개는 건너뜁니다` : '') +
      '.';

    if (pausedWithRemaining !== undefined) {
      return failure(
        `멈췄습니다: 기록 ${recorded.length}건, 남은 씬 ${pausedWithRemaining}개. 다시 실행하면 이어서 기록합니다.`,
        storyStateGeneration,
      );
    }

    if (failures.length > 0) {
      return failure(
        `${failures.length}건 실패 (기록 ${recorded.length}건): ${failures.map((failure) => `${failure.stem} — ${failure.message}`).join(', ')}`,
        storyStateGeneration,
      );
    }

    return success(summary, storyStateGeneration);
  }
}
