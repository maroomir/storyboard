import { applyPromptTuningOverrides, resetPromptTuningOverrides } from '@storyboard/story-ai';
import type { PromptTuningOverrides, UsageRecord } from '@storyboard/story-ai';
import type { SceneGenerationTuning } from '@storyboard/story-pipeline';

import type { ISimWorkspaceFactory } from '#sim/ports/workspaceFactory';
import { summarizeUsage, type TokenTotals } from '#sim/run/usageLedger';
import { measureScene, summarizeScenes, type SceneMetrics, type TrackMetrics } from '#sim/score/deterministic';

export interface SceneTarget {
  readonly sceneStem: string;
  readonly targetLength: number;
}

export interface TrackRunInput {
  readonly factory: ISimWorkspaceFactory;
  readonly workspacePath: string;
  readonly scenes: readonly SceneTarget[];
  readonly tuning: SceneGenerationTuning;
  readonly promptOverrides: PromptTuningOverrides;
  readonly sectionOutputLimit?: number;
  readonly onProgress?: (sceneStem: string, index: number, total: number) => void;
  readonly shouldCancel?: () => boolean;
}

export interface TrackRunResult {
  readonly metrics: TrackMetrics;
  readonly tokens: TokenTotals;
  readonly drafts: ReadonlyMap<string, string>;
  // 생성이 실패한 씬. 원고가 없으므로 심판도 원장도 그 씬은 판정할 수 없다.
  readonly failures: readonly string[];
  readonly wallClockMs: number;
}

export class TrackRunCancelledError extends Error {
  public readonly code = 'cancelled';

  public constructor() {
    super('측정을 취소했습니다.');
    this.name = 'TrackRunCancelledError';
  }
}

// 트랙 한 벌을 한 지점으로 돌린다. 씬은 순서대로 돌아야 한다 — 연쇄 트랙은 앞 씬이 남긴 상태를
// 뒤 씬이 읽으므로, 순서를 바꾸면 연속성 자체가 측정 대상에서 빠진다.
export async function runTrack(input: TrackRunInput): Promise<TrackRunResult> {
  const startedAt = Date.now();

  // 프롬프트 손잡이는 전역 덮개로 간다. 한 프로세스가 한 지점만 돌린다는 전제이고, 끝나면 되돌린다.
  applyPromptTuningOverrides(input.promptOverrides);

  try {
    const generator = await input.factory.open({
      workspacePath: input.workspacePath,
      tuning: input.tuning,
      ...(input.sectionOutputLimit === undefined
        ? {}
        : { sectionOutputLimit: input.sectionOutputLimit }),
    });

    const sceneMetrics: SceneMetrics[] = [];
    const drafts = new Map<string, string>();
    const usage: UsageRecord[] = [];
    const failures: string[] = [];

    for (const [index, scene] of input.scenes.entries()) {
      if (input.shouldCancel?.() === true) {
        throw new TrackRunCancelledError();
      }

      input.onProgress?.(scene.sceneStem, index + 1, input.scenes.length);

      const outcome = await generator.generate(scene.sceneStem);
      usage.push(...generator.drainUsage());

      if (!outcome.ok) {
        failures.push(`${scene.sceneStem}: ${outcome.message ?? outcome.kind}`);
        continue;
      }

      const draft = await generator.readDraft(scene.sceneStem);
      drafts.set(scene.sceneStem, draft);
      sceneMetrics.push(
        measureScene({
          sceneStem: scene.sceneStem,
          targetLength: scene.targetLength,
          draft,
          warnings: outcome.warnings,
        }),
      );
    }

    return {
      metrics: summarizeScenes(sceneMetrics),
      tokens: summarizeUsage(usage),
      drafts,
      failures,
      wallClockMs: Date.now() - startedAt,
    };
  } finally {
    resetPromptTuningOverrides();
  }
}
