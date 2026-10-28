import * as vscode from 'vscode';

import type { IStudioFollowUpRepository } from '@storyboard/story-engine';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import { isSafeStudioEntityKey } from '@storyboard/story-model';
import type {
  StoryboardResponsePayload,
  StudioEntity,
  StudioFollowUp,
} from '@storyboard/story-model';

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

export class StudioFollowUpRpc {
  public constructor(private readonly deps: StudioFollowUpRpcHandlersDependencies) {}

  public handlers(): StoryboardRpcHandlers {
    return {
      'studio.followUp.list': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.followUp.list'>> => {
        const root: vscode.Uri | undefined = await this.deps.getProjectRoot();

        if (!root) {
          return { followUps: [] };
        }

        const followUps: readonly StudioFollowUp[] = await this.deps.repository.list(
          root,
          payload.entity,
        );

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
        const root: vscode.Uri | undefined = await this.deps.getProjectRoot();

        if (root) {
          await this.deps.repository.dismiss(root, payload.id);
        }

        return {};
      },

      'studio.followUp.open': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.followUp.open'>> => {
        const root: vscode.Uri | undefined = await this.deps.getProjectRoot();

        if (!root) {
          return { opened: false };
        }

        const targetFile: string | undefined = entityTargetFile(payload.entity);

        if (!targetFile || targetFile !== payload.targetFile) {
          return { opened: false };
        }

        try {
          const uri: vscode.Uri = vscode.Uri.joinPath(root, targetFile);
          await vscode.window.showTextDocument(uri, { preview: true });
          return { opened: true };
        } catch {
          return { opened: false };
        }
      },
    };
  }
}
