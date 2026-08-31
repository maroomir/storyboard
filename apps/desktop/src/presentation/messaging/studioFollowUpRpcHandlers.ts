import * as vscode from 'vscode';

import type { IStudioFollowUpRepository } from '@storyboard/story-engine';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import { isSafeStudioEntityKey } from '@storyboard/story-engine';
import type { StoryboardResponsePayload, StudioEntity } from '@storyboard/story-engine';

export interface StudioFollowUpRpcHandlersDependencies {
  readonly repository: IStudioFollowUpRepository;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
}

function entityTargetFile(entity: StudioEntity): string | undefined {
  if (!isSafeStudioEntityKey(entity.key)) {
    return undefined;
  }

  switch (entity.kind) {
    case 'character':
    case 'background':
      return `${entity.kind}/${entity.key}.card`;
    case 'scene':
      return `scene/${entity.key}.card`;
    case 'project':
      return undefined;
  }
}

export function createStudioFollowUpRpcHandlers(
  deps: StudioFollowUpRpcHandlersDependencies,
): StoryboardRpcHandlers {
  return {
    'studio.followUp.list': async (
      payload,
    ): Promise<StoryboardResponsePayload<'studio.followUp.list'>> => {
      const root = await deps.getProjectRoot();

      if (!root) {
        return { followUps: [] };
      }

      const followUps = await deps.repository.list(root, payload.entity);

      return {
        followUps: followUps.map((followUp) => ({
          id: followUp.id,
          origin: followUp.origin,
          reason: followUp.reason,
          instruction: followUp.instruction,
        })),
      };
    },

    'studio.followUp.dismiss': async (
      payload,
    ): Promise<StoryboardResponsePayload<'studio.followUp.dismiss'>> => {
      const root = await deps.getProjectRoot();

      if (root) {
        await deps.repository.dismiss(root, payload.id);
      }

      return {};
    },

    'studio.followUp.open': async (
      payload,
    ): Promise<StoryboardResponsePayload<'studio.followUp.open'>> => {
      const root = await deps.getProjectRoot();

      if (!root) {
        return { opened: false };
      }

      // SECURITY: the path arrives from the webview, so it is rebuilt from the validated entity
      // rather than trusted as given.
      const targetFile = entityTargetFile(payload.entity);

      if (!targetFile || targetFile !== payload.targetFile) {
        return { opened: false };
      }

      try {
        const uri = vscode.Uri.joinPath(root, targetFile);
        // NOTE: opened as a preview tab so walking a chain of follow-ups does not bury the author
        // in editor tabs.
        await vscode.window.showTextDocument(uri, { preview: true });
        return { opened: true };
      } catch {
        return { opened: false };
      }
    },
  };
}
