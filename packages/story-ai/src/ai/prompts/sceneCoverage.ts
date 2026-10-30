import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export const SceneCoveragePrompt: PromptModule<
  [beats: readonly string[], draft: string, variant?: PromptVariantId]
> = {
  config: promptTuning('sceneCoverage'),
  build(
    beats: readonly string[],
    draft: string,
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('sceneCoverage', variant, {
      view: { numberedBeats: numberedBeats(beats), draft },
    });
  },
};

function numberedBeats(beats: readonly string[]): string {
  return beats.map((beat, index) => `${index + 1}. ${beat}`).join('\n');
}
