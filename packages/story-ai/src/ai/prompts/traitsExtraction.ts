import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

export const TraitsExtractionPrompt = {
  config: promptTuning('traitsExtraction'),
  build(
    script: string,
    characterName: string,
    aliases?: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('traitsExtraction', variant, {
      view: {
        characterName,
        aliasList:
          aliases && aliases.length > 0
            ? aliases.map((alias) => `"${alias}"`).join(', ')
            : undefined,
        script,
      },
    });
  },
} as const;
