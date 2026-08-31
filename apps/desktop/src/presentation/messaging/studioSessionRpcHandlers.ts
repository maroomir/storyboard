import * as vscode from 'vscode';

import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { StoryboardResponsePayload } from '@/shared/messaging';
import type { IStudioSessionRepository } from '../../infrastructure/persistence/repositories/studioSessionRepository';

export interface StudioSessionRpcHandlersDependencies {
  readonly repository: IStudioSessionRepository;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
}

export function createStudioSessionRpcHandlers(
  deps: StudioSessionRpcHandlersDependencies,
): StoryboardRpcHandlers {
  const { repository, getProjectRoot } = deps;

  return {
    'studio.session.save': async (
      payload,
    ): Promise<StoryboardResponsePayload<'studio.session.save'>> => {
      const root = await getProjectRoot();

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
      const root = await getProjectRoot();
      const sessions = root ? await repository.list(root, payload.entity) : [];
      return { sessions: [...sessions] };
    },

    'studio.session.latest': async (
      payload,
    ): Promise<StoryboardResponsePayload<'studio.session.latest'>> => {
      const root = await getProjectRoot();
      const session = root ? await repository.loadLatest(root, payload.entity) : undefined;
      return { session };
    },

    'studio.session.load': async (
      payload,
    ): Promise<StoryboardResponsePayload<'studio.session.load'>> => {
      const root = await getProjectRoot();
      const session = root ? await repository.load(root, payload.entity, payload.id) : undefined;
      return { session };
    },
  };
}
