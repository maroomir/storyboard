import * as vscode from 'vscode';

import type { StudioChatStage, StudioChatUseCase } from '@/application/studio/studioChatUseCase';
import {
  readStudioEntityContext,
  resolveStudioLookups,
} from '@/infrastructure/persistence/studioEntityContext';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type {
  StoryboardResponsePayload,
  StudioChatTurn,
  StudioEntity,
  StudioTarget,
} from '@/shared/messaging';

export interface StudioChatRpcHandlersDependencies {
  readonly useCase: StudioChatUseCase;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
  readonly getTarget: () => Promise<StudioTarget>;
  readonly postProgress: (stage: StudioChatStage | 'idle') => void;
}

const validationSettingKey = 'studio.validation';

export function createStudioChatRpcHandlers(
  deps: StudioChatRpcHandlersDependencies,
): StoryboardRpcHandlers {
  // NOTE: a provider call cannot be aborted mid-flight, so a cancel bumps the generation and the
  // reply that eventually lands is dropped instead of appearing after the author moved on.
  let generation = 0;

  return {
    'studio.chat.send': async (payload): Promise<StoryboardResponsePayload<'studio.chat.send'>> => {
      const root = await deps.getProjectRoot();

      if (!root) {
        return { turns: [sayTurn('Storyboard 프로젝트를 먼저 열어 주세요.')] };
      }

      const entityContext = await readStudioEntityContext(root, payload.entity);

      if (!entityContext) {
        return { turns: [sayTurn(missingEntityMessage(payload.entity))] };
      }

      const target = await deps.getTarget();
      const startedGeneration = generation;

      try {
        const turns = await deps.useCase.send({
          workspaceRoot: root,
          entityContext,
          history: payload.history,
          instruction: payload.instruction,
          hasSelection: target.hasSelection,
          isValidationEnabled: isValidationEnabled(),
          resolveLookup: (requests) => resolveStudioLookups(root, requests),
          createTurnId: () => crypto.randomUUID(),
          onStage: deps.postProgress,
        });

        return { turns: generation === startedGeneration ? [...turns] : [] };
      } finally {
        deps.postProgress('idle');
      }
    },

    'studio.chat.cancel': async (): Promise<StoryboardResponsePayload<'studio.chat.cancel'>> => {
      generation += 1;
      deps.postProgress('idle');
      return {};
    },
  };
}

function isValidationEnabled(): boolean {
  return vscode.workspace.getConfiguration('storyboard').get<boolean>(validationSettingKey, true);
}

function sayTurn(message: string): StudioChatTurn {
  return { id: crypto.randomUUID(), role: 'assistant', kind: 'say', message };
}

function missingEntityMessage(entity: StudioEntity): string {
  return entity.kind === 'scene'
    ? `scene/${entity.key}.card 를 찾을 수 없어요.`
    : `${entity.kind}/${entity.key}.card 를 찾을 수 없어요.`;
}
