import {
  isSpanRequiredTool,
  studioToolNamesByShape,
  type StudioAgentToolName,
} from '#ai/contracts/studioAgent';
import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import type { PromptArtifact } from './types';

export type StudioAgentPatchShape = 'entityCard' | 'sceneCard' | 'draft';

export interface StudioAgentPromptInput {
  readonly entityKind: 'character' | 'background' | 'scene';
  readonly patchShape: StudioAgentPatchShape;
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

export const StudioAgentPrompt = {
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
} as const;

const editableSceneCardFields = [
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
