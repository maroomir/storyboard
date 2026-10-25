import { applyPromptTuningOverrides, resetPromptTuningOverrides } from '@storyboard/story-ai';
import type { PromptTuningOverrides } from '@storyboard/story-ai';
import type { UsageRecord } from '@storyboard/story-model';
import type { SceneGenerationTuning } from '@storyboard/story-engine';

import type { ISimWorkspaceFactory, SceneGenerationOutcome, SimSceneGenerator } from '#sim/ports/workspaceFactory';
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
  readonly failures: readonly string[];
  readonly wallClockMs: number;
}

export class TrackRunCancelledError extends Error {
  public readonly code: "cancelled" = 'cancelled';

  public constructor() {
    super('측정을 취소했습니다.');
    this.name = 'TrackRunCancelledError';
  }
}

export async function runTrack(input: TrackRunInput): Promise<TrackRunResult> {
  const startedAt: number = Date.now();

  applyPromptTuningOverrides(input.promptOverrides);

  try {
    const generator: SimSceneGenerator = await input.factory.open({
      workspacePath: input.workspacePath,
      tuning: input.tuning,
      ...(input.sectionOutputLimit === undefined
        ? {}
        : { sectionOutputLimit: input.sectionOutputLimit }),
    });

    const sceneMetrics: SceneMetrics[] = [];
    const drafts: Map<string, string> = new Map<string, string>();
    const usage: UsageRecord[] = [];
    const failures: string[] = [];

    for (const [index, scene] of input.scenes.entries()) {
      if (input.shouldCancel?.() === true) {
        throw new TrackRunCancelledError();
      }

      input.onProgress?.(scene.sceneStem, index + 1, input.scenes.length);

      const outcome: SceneGenerationOutcome = await generator.generate(scene.sceneStem);
      usage.push(...generator.drainUsage());

      if (!outcome.ok) {
        failures.push(`${scene.sceneStem}: ${outcome.message ?? outcome.kind}`);
        continue;
      }

      const draft: string = await generator.readDraft(scene.sceneStem);
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
