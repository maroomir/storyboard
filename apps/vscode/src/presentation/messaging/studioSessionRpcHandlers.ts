import * as vscode from 'vscode';

import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type {
  StoryboardResponsePayload,
  StudioSessionSnapshot,
  StudioSessionSummary,
} from '@storyboard/story-model';
import type { IStudioSessionRepository } from '@storyboard/story-engine';

export interface StudioSessionRpcHandlersDependencies {
  readonly repository: IStudioSessionRepository;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
}

export class StudioSessionRpc {
  public constructor(private readonly deps: StudioSessionRpcHandlersDependencies) {}

  public handlers(): StoryboardRpcHandlers {
    const { repository, getProjectRoot } = this.deps;

    return {
      'studio.session.save': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.session.save'>> => {
        const root: vscode.Uri | undefined = await getProjectRoot();

        if (root) {
          await repository.save(root, {
            id: payload.id,
            entity: payload.entity,
            createdAt: payload.createdAt,
            hasAppliedChanges: payload.hasAppliedChanges,
            turns: payload.turns,
          });
        }

        return {};
      },

      'studio.session.list': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.session.list'>> => {
        const root: vscode.Uri | undefined = await getProjectRoot();
        const sessions: readonly StudioSessionSummary[] = root
          ? await repository.list(root, payload.entity)
          : [];
        return { sessions: [...sessions] };
      },

      'studio.session.latest': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.session.latest'>> => {
        const root: vscode.Uri | undefined = await getProjectRoot();
        const session: StudioSessionSnapshot | undefined = root
          ? await repository.loadLatest(root, payload.entity)
          : undefined;
        return { session };
      },

      'studio.session.load': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.session.load'>> => {
        const root: vscode.Uri | undefined = await getProjectRoot();
        const session: StudioSessionSnapshot | undefined = root
          ? await repository.load(root, payload.entity, payload.id)
          : undefined;
        return { session };
      },
    };
  }
}
