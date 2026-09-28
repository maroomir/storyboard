import type { Character } from '@storyboard/story-format';
import { formatCardAttributes, joinCardText } from '@storyboard/story-format';
import { voiceStyleLines, type StyleDirective } from '#ai/contracts/styleDirective';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const PersonaGenerationPrompt = {
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
} as const;
