import * as vscode from 'vscode';

import type { IStudioFollowUpRepository } from '@/infrastructure/persistence/repositories/studioFollowUpRepository';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { StoryboardResponsePayload } from '@/shared/messaging';

export interface StudioFollowUpRpcHandlersDependencies {
  readonly repository: IStudioFollowUpRepository;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
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

      try {
        const uri = vscode.Uri.joinPath(root, payload.targetFile);
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
