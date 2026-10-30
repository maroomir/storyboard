import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export const TraitsExtractionPrompt: PromptModule<
  [script: string, characterName: string, aliases?: readonly string[], variant?: PromptVariantId]
> = {
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
};
