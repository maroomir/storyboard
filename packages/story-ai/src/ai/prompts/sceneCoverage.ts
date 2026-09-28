import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const SceneCoveragePrompt = {
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
} as const;

function numberedBeats(beats: readonly string[]): string {
  return beats.map((beat, index) => `${index + 1}. ${beat}`).join('\n');
}
