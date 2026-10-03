import type { Background, SceneGrounding } from '@storyboard/story-model';
import { joinCardText } from '@storyboard/story-model';
import {
  craftContractLines,
  sceneGroundingLines,
  voiceStyleLines,
  type StyleDirective,
} from '#ai/contracts/styleDirective';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const PersonaDialoguePrompt = {
  config: promptTuning('personaDialogue'),
  build(
    situation: string,
    personas: ReadonlyMap<string, string>,
    background: Background,
    previousContext?: string,
    variant: PromptVariantId = 'generic',
    style?: StyleDirective,
    grounding?: SceneGrounding,
  ): PromptArtifact {
    const knowledge = style?.narration?.knowledge;
    const groundingLines = sceneGroundingLines(grounding);

    return renderPrompt('personaDialogue', variant, {
      view: {
        isRich: variant === 'rich',
        hasPovInteriority: knowledge === 'witnessed' || knowledge === 'retrospective',
        backgroundDescription: joinCardText(background.description),
        backgroundTags:
          background.tags && background.tags.length > 0 ? background.tags.join(', ') : undefined,
        styleLines: [...voiceStyleLines(style), ...craftContractLines(style?.craftContract)],
        sceneGrounding: groundingLines.length > 0 ? groundingLines.join('\n') : undefined,
        hasPersonas: personas.size > 0,
        personas: Array.from(personas.entries()).map(([name, persona]) => ({ name, persona })),
        previousContext,
        situation,
      },
    });
  },
} as const;
