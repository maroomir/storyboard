import type { BibleSubjectKind, InterviewAxis } from '@storyboard/story-model';

import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export interface InterviewAxisScene {
  readonly stem: string;
  readonly title?: string;
  readonly beats: readonly string[];
}

export interface InterviewAxisScenesInput {
  readonly cardType: BibleSubjectKind;
  readonly synopsis?: string;
  readonly axes: readonly InterviewAxis[];
  readonly scenes: readonly InterviewAxisScene[];
}

export const InterviewAxisScenesPrompt: PromptModule<
  [input: InterviewAxisScenesInput, variant?: PromptVariantId]
> = {
  config: promptTuning('interviewAxisScenes'),
  build(input: InterviewAxisScenesInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('interviewAxisScenes', variant, {
      view: {
        isBackground: input.cardType === 'background',
        synopsis: input.synopsis,
        axes: input.axes.map((axis) => ({
          id: axis.id,
          label: axis.label,
          values: axis.values.map((value) => value.label).join(' / '),
        })),
        scenes: input.scenes.map((scene) => ({ stem: scene.stem, title: scene.title, beats: scene.beats })),
      },
    });
  },
};

function readSceneAxisIds(
  entry: unknown,
  knownAxisIds: ReadonlySet<string>,
): readonly [stem: string, axisIds: string[]] | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }

  const record: Record<string, unknown> = entry as Record<string, unknown>;
  const stem: string = typeof record.stem === 'string' ? record.stem.trim() : '';
  if (stem.length === 0 || !Array.isArray(record.axisIds)) {
    return undefined;
  }

  const axisIds: string[] = record.axisIds.flatMap((axisId): string[] =>
    typeof axisId === 'string' && knownAxisIds.has(axisId.trim()) ? [axisId.trim()] : [],
  );

  return [stem, [...new Set(axisIds)]];
}

export function coerceInterviewAxisScenes(
  parsed: Record<string, unknown> | null,
  input: Pick<InterviewAxisScenesInput, 'axes' | 'scenes'>,
): Map<string, string[]> {
  const knownAxisIds: ReadonlySet<string> = new Set(input.axes.map((axis) => axis.id));
  const askedStems: ReadonlySet<string> = new Set(input.scenes.map((scene) => scene.stem));
  const axisIdsByStem: Map<string, string[]> = new Map<string, string[]>();

  for (const entry of Array.isArray(parsed?.scenes) ? parsed.scenes : []) {
    const pair: readonly [string, string[]] | undefined = readSceneAxisIds(entry, knownAxisIds);
    if (pair !== undefined && askedStems.has(pair[0]) && !axisIdsByStem.has(pair[0])) {
      axisIdsByStem.set(pair[0], pair[1]);
    }
  }

  return axisIdsByStem;
}
