import { afterEach, describe, expect, it } from 'vitest';

import {
  SceneSkeletonPrompt,
  applyPromptTuningOverrides,
  promptTuning,
  promptTuningKeys,
  resetPromptTuningOverrides,
} from '@storyboard/story-ai';
import { applyOverlay } from '@storyboard/story-sim';

afterEach(() => {
  resetPromptTuningOverrides();
});

describe('prompt tuning override', () => {
  it('leaves the defaults alone until something overrides them', () => {
    const defaults = promptTuning('sceneSkeleton');

    expect(SceneSkeletonPrompt.config.temperature).toBe(defaults.temperature);
    expect(SceneSkeletonPrompt.config.maxTokens).toBe(defaults.maxTokens);
  });

  it('reaches a prompt module that captured its config at import time', () => {
    const before = SceneSkeletonPrompt.config.temperature;

    applyPromptTuningOverrides({ sceneSkeleton: { temperature: before + 0.25 } });

    expect(SceneSkeletonPrompt.config.temperature).toBe(before + 0.25);
  });

  it('leaves the field it was not given at the data-file value', () => {
    const before = SceneSkeletonPrompt.config.maxTokens;

    applyPromptTuningOverrides({ sceneSkeleton: { temperature: 0.1 } });

    expect(SceneSkeletonPrompt.config.maxTokens).toBe(before);
  });

  it('touches only the prompt it names', () => {
    const before = promptTuning('draftCritique').temperature;

    applyPromptTuningOverrides({ sceneSkeleton: { temperature: 1.9 } });

    expect(promptTuning('draftCritique').temperature).toBe(before);
  });

  it('puts the defaults back', () => {
    const before = SceneSkeletonPrompt.config.temperature;

    applyPromptTuningOverrides({ sceneSkeleton: { temperature: 1.5 } });
    resetPromptTuningOverrides();

    expect(SceneSkeletonPrompt.config.temperature).toBe(before);
  });
});

describe('overlay routing', () => {
  it('sends a prompt knob to the prompt overrides, not to the pipeline tuning', () => {
    const { tuning, promptOverrides, refusals } = applyOverlay(
      { knobs: { 'prompt.sceneSkeleton.temperature': 0.9, 'generation.skeleton.lengthRatio': 0.8 } },
      'claude',
    );

    expect(refusals).toEqual([]);
    expect(tuning).toEqual({ 'generation.skeleton.lengthRatio': 0.8 });
    expect(promptOverrides).toEqual({ sceneSkeleton: { temperature: 0.9 } });
  });

  it('merges both fields of one prompt into a single entry', () => {
    const { promptOverrides } = applyOverlay(
      {
        knobs: {
          'prompt.sceneSkeleton.temperature': 0.9,
          'prompt.sceneSkeleton.maxTokens': 9000,
        },
      },
      'claude',
    );

    expect(promptOverrides).toEqual({ sceneSkeleton: { temperature: 0.9, maxTokens: 9000 } });
  });

  it('refuses a temperature outside the sampler range', () => {
    const { refusals } = applyOverlay(
      { knobs: { 'prompt.sceneSkeleton.temperature': 3 } },
      'claude',
    );

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('범위 밖');
  });

  it('names every prompt in the table', () => {
    for (const key of promptTuningKeys()) {
      const { refusals } = applyOverlay(
        { knobs: { [`prompt.${key}.temperature`]: 0.5 } },
        'claude',
      );

      expect(refusals, key).toEqual([]);
    }
  });
});
