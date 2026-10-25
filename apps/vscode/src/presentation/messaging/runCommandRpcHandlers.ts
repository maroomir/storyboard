import * as vscode from 'vscode';

import type { StoryboardResponsePayload } from '@storyboard/story-model';

import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';

export function createRunCommandRpcHandlers(): StoryboardRpcHandlers {
  return {
    'workspace.runCommand': async (
      payload,
    ): Promise<StoryboardResponsePayload<'workspace.runCommand'>> => {
      await vscode.commands.executeCommand(payload.command);
      return {};
    },
  };
}
