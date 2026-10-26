import { flagBoolean } from '@/cliArguments';
import type { CommandHandler } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import type { GenerateStoryStateResult } from '@storyboard/story-engine';
import { formatSceneOrderRanges } from '@storyboard/story-model';

function parseSceneOrders(raw: string): readonly number[] | undefined {
  const orders: Set<number> = new Set<number>();

  for (const part of raw.split(',')) {
    const bounds: RegExpExecArray | null = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    const start: number = Number(bounds?.[1]);

    if (bounds === undefined || bounds === null || !Number.isInteger(start)) {
      return undefined;
    }

    const end: number = bounds[2] === undefined ? start : Number(bounds[2]);

    if (end < start) {
      return undefined;
    }

    for (let order: number = start; order <= end; order += 1) {
      orders.add(order);
    }
  }

  return [...orders];
}

export const generateState: CommandHandler = async ({ container, args }) => {
  const rawOrders: string | undefined = args.positionals[0];
  const sceneOrders: readonly number[] | undefined =
    rawOrders === undefined ? undefined : parseSceneOrders(rawOrders);

  if (rawOrders !== undefined && sceneOrders === undefined) {
    return failure(
      `씬 범위를 알아볼 수 없습니다: ${rawOrders}\n  5 · 5-8 · 5,7,9 처럼 적어 주세요.`,
    );
  }

  const storyStateGeneration: GenerateStoryStateResult = await container.drafts.generateStoryState({
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
};

export const resealState: CommandHandler = async ({ container, args }) => {
  const rawOrders: string | undefined = args.positionals[0];
  const sceneOrders: readonly number[] | undefined =
    rawOrders === undefined ? undefined : parseSceneOrders(rawOrders);

  if (rawOrders !== undefined && sceneOrders === undefined) {
    return failure(
      `씬 범위를 알아볼 수 없습니다: ${rawOrders}\n  5 · 5-8 · 5,7,9 처럼 적어 주세요.`,
    );
  }

  const resealed: readonly number[] = await container.drafts.resealStoryState(
    container.workspaceRoot,
    sceneOrders,
  );

  return success(
    resealed.length === 0
      ? '다시 봉인할 낡은 항목이 없습니다.'
      : `씬 ${formatSceneOrderRanges(resealed)}의 원장 항목을 지금의 카드·씬으로 다시 봉인했습니다.`,
    { sceneOrders: resealed },
  );
};
