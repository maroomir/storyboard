import type { GenerationKnobs } from '@storyboard/story-model';

import { generationParameterDefault } from '#engine/pipeline/sceneGenerationTuning';

export interface InterviewTuning {
  readonly optionCount: number;
  readonly explorationOptions: number;
  readonly offBeatQuestionsPerSession: number;
  readonly maxQuestionsPerSession: number;
  readonly upcomingScenes: number;
  readonly axesPerCardType: number;
  readonly chosenWeight: number;
  readonly writtenWeight: number;
  readonly distillMinimumWeight: number;
  readonly rebuildAfterWrittenStreak: number;
}

function knob(knobs: GenerationKnobs | undefined, leaf: keyof InterviewTuning): number {
  const id: string = `generation.interview.${leaf}`;

  return knobs?.[id] ?? generationParameterDefault(id);
}

export function resolveInterviewTuning(knobs: GenerationKnobs | undefined): InterviewTuning {
  return {
    optionCount: knob(knobs, 'optionCount'),
    explorationOptions: knob(knobs, 'explorationOptions'),
    offBeatQuestionsPerSession: knob(knobs, 'offBeatQuestionsPerSession'),
    maxQuestionsPerSession: knob(knobs, 'maxQuestionsPerSession'),
    upcomingScenes: knob(knobs, 'upcomingScenes'),
    axesPerCardType: knob(knobs, 'axesPerCardType'),
    chosenWeight: knob(knobs, 'chosenWeight'),
    writtenWeight: knob(knobs, 'writtenWeight'),
    distillMinimumWeight: knob(knobs, 'distillMinimumWeight'),
    rebuildAfterWrittenStreak: knob(knobs, 'rebuildAfterWrittenStreak'),
  };
}
