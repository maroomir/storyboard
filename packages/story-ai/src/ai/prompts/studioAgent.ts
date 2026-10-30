import {
  isSpanRequiredTool,
  studioToolNamesByShape,
  type StudioAgentEntityKind,
  type StudioAgentToolName,
  type StudioPatchTarget,
} from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import type { PromptArtifact, PromptModule } from '#ai/ai/prompts/types';

export interface StudioAgentPromptInput {
  readonly entityKind: StudioAgentEntityKind;
  readonly patchShape: StudioPatchTarget;
  readonly entityLabel: string;
  readonly targetFile: string;
  readonly context: string;
  readonly conversation: string;
  readonly instruction: string;
  readonly canAsk: boolean;
  readonly canLookup: boolean;
  readonly canInvoke: boolean;
  readonly pinnedTool?: StudioAgentToolName;
  readonly hasSelection: boolean;
}

export const StudioAgentPrompt: PromptModule<[input: StudioAgentPromptInput]> = {
  config: promptTuning('studioAgent'),
  build(input: StudioAgentPromptInput): PromptArtifact {
    return renderPrompt('studioAgent', 'generic', {
      view: {
        isDraft: input.patchShape === 'draft',
        isSceneCard: input.patchShape === 'sceneCard',
        isEntityCard: input.patchShape !== 'draft' && input.patchShape !== 'sceneCard',
        isCharacterEntity: input.entityKind === 'character',
        isBackgroundEntity: input.entityKind === 'background',
        isSceneEntity: input.entityKind === 'scene',
        canAsk: input.canAsk,
        canLookup: input.canLookup,
        canInvoke: input.canInvoke,
        tools: input.canInvoke ? studioToolNamesByShape[input.patchShape].join('|') : undefined,
        pinnedTool: input.pinnedTool,
        isPinnedToolSpanRequired:
          input.pinnedTool !== undefined && isSpanRequiredTool(input.pinnedTool),
        hasSelection: input.hasSelection,
        editableSceneCardFields: editableSceneCardFields.join(', '),
        entityLabel: input.entityLabel,
        targetFile: input.targetFile,
        context: input.context,
        conversation: input.conversation,
        instruction: input.instruction,
      },
    });
  },
};

const editableSceneCardFields: string[] = [
  'title',
  'summary',
  'purpose',
  'conflict',
  'twist',
  'emotionalShift',
  'endState',
  'foreshadowing',
  'mood',
  'relationStage',
  'characters',
  'location',
];
