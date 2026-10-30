import type { Character } from '@storyboard/story-model';
import {
  formatCardAttributes,
  joinCardText,
  voiceStyleLines,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export const PersonaGenerationPrompt: PromptModule<
  [character: Character, variant?: PromptVariantId, style?: StyleDirective]
> = {
  config: promptTuning('personaGeneration'),
  build(
    character: Character,
    variant: PromptVariantId = 'generic',
    style?: StyleDirective,
  ): PromptArtifact {
    return renderPrompt('personaGeneration', variant, {
      view: {
        name: character.name,
        voice: joinCardText(character.voice),
        description: joinCardText(character.description),
        desire: joinCardText(character.desire),
        role: character.role,
        attributes: formatCardAttributes(character.attributes),
        hasTraits: Boolean(character.traits && character.traits.length > 0),
        traits: character.traits?.slice(0, 10).join(', '),
        styleLines: voiceStyleLines(style),
      },
    });
  },
};
